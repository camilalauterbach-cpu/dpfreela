// Q-024-D-UI-MULTIPLE — Read model unificado das qualificações do trabalhador.
// Fontes:
//   A) worker_sst_qualifications_current  (NRs e treinamentos vigentes)
//   B) worker_documents (não deletados)   filtrados por document_type_id cujo
//      storage_flow do catálogo canônico for `worker_documents` (ASO).
//   C) catálogo `useWorkerQualificationTypes` para code/name/category/storageFlow.
//
// Regras:
//   - Não retorna sucesso parcial silencioso — loading/error/success distintos.
//   - Se o mesmo document_type_id aparecer nas duas fontes, sinalizamos
//     `sourceConflict = true` e mantemos AMBAS as linhas (não escolhemos SST
//     automaticamente); um log de erro é emitido para investigação.
//   - Não escreve ASO em worker_sst_qualifications.
//   - ASO sem issued/expires resulta em status `validity_unknown`.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useWorkerQualificationTypes,
  type WorkerQualificationType,
  type WorkerQualificationCategory,
  type WorkerQualificationStorageFlow,
} from "./useWorkerQualificationTypes";

export type UnifiedQualStatus =
  | "valid"
  | "warning"
  | "expired"
  | "missing_file"
  | "validity_unknown"
  | "rejected"
  | "pending";

export interface UnifiedQualificationRow {
  /** id da linha na fonte (SST id ou worker_documents id). */
  id: string;
  workerId: string;
  documentTypeId: string;
  code: string;
  name: string;
  category: WorkerQualificationCategory;
  storageFlow: WorkerQualificationStorageFlow;
  /** Origem do registro. */
  source: "sst" | "worker_documents";
  issuedAt: string | null;
  expiresAt: string | null;
  validityStatus: string | null;
  documentStatus: string | null;
  status: UnifiedQualStatus;
  documentUrl: string | null;
  filePath: string | null;
  revisionType: string | null;
  isCurrent: boolean;
  /** True quando o mesmo document_type_id aparece nas duas fontes. */
  sourceConflict: boolean;
  /** True quando há mais de uma linha atual candidata na mesma fonte. */
  integrityConflict: boolean;
  /** Somente sst — payload cru para consumidores que ainda precisam. */
  sstRaw?: any;
  /** Somente worker_documents — payload cru. */
  docRaw?: any;
}

const WARNING_DAYS = 30;

function classifyExpiration(
  expiresAt: string | null,
  validityStatus: string | null,
): UnifiedQualStatus | null {
  if (validityStatus === "no_expiry") return "valid";
  if (!expiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiresAt + "T12:00:00");
  const diffDays = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= WARNING_DAYS) return "warning";
  return "valid";
}

function classifySst(row: any): UnifiedQualStatus {
  if (row.document_status === "revoked") return "rejected";
  if (!row.document_url) return "missing_file";
  if (row.expiration_status === "expired") return "expired";
  if (row.expiration_status === "expiring_soon") return "warning";
  const byDates = classifyExpiration(row.expires_at, row.validity_status);
  if (byDates) return byDates;
  return row.validity_status === "unknown" ? "validity_unknown" : "valid";
}

function classifyDoc(row: any): UnifiedQualStatus {
  const status = String(row.status || "").toLowerCase();
  if (status === "rejected") return "rejected";
  if (status === "pending" || status === "review") return "pending";
  if (!row.file_path && !row.document_url) return "missing_file";
  const issuedAt = row.issue_date || row.issued_at;
  const expiresAt = row.expiry_date || row.expires_at;
  if (!issuedAt && !expiresAt) return "validity_unknown";
  const byDates = classifyExpiration(expiresAt, null);
  if (byDates) return byDates;
  return "validity_unknown";
}

const STATUS_ORDER: UnifiedQualStatus[] = [
  "expired",
  "warning",
  "missing_file",
  "pending",
  "rejected",
  "validity_unknown",
  "valid",
];

export function useWorkerQualificationsUnified(workerId: string | undefined) {
  const typesQ = useWorkerQualificationTypes({ includeInactive: true });

  const sstQ = useQuery({
    queryKey: ["worker-sst-current", workerId],
    enabled: !!workerId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("*")
        .eq("worker_id", workerId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const asoTypeIds = useMemo(() => {
    return (typesQ.data ?? [])
      .filter((t) => t.storageFlow === "worker_documents")
      .map((t) => t.documentTypeId);
  }, [typesQ.data]);

  const docsQ = useQuery({
    queryKey: ["worker-qualifications-unified-docs", workerId, asoTypeIds.sort().join(",")],
    enabled: !!workerId && asoTypeIds.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_documents")
        .select("*")
        .eq("worker_id", workerId)
        .is("deleted_at", null)
        .in("document_type_id", asoTypeIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const isLoading =
    typesQ.isLoading ||
    sstQ.isLoading ||
    (asoTypeIds.length > 0 && docsQ.isLoading);
  const error = typesQ.error || sstQ.error || docsQ.error || null;

  const rows = useMemo<UnifiedQualificationRow[]>(() => {
    if (isLoading || error) return [];
    const types = typesQ.data ?? [];
    const typesById = new Map<string, WorkerQualificationType>();
    for (const t of types) typesById.set(t.documentTypeId, t);

    // Detecta múltiplos vigentes por (worker, document_type) na mesma fonte.
    const sstBucket = new Map<string, any[]>();
    for (const r of sstQ.data ?? []) {
      const key = r.document_type_id ?? `nrcode:${r.nr_code}`;
      const arr = sstBucket.get(key) ?? [];
      arr.push(r);
      sstBucket.set(key, arr);
    }
    const docBucket = new Map<string, any[]>();
    for (const r of docsQ.data ?? []) {
      const key = r.document_type_id;
      if (!key) continue;
      const arr = docBucket.get(key) ?? [];
      arr.push(r);
      docBucket.set(key, arr);
    }

    const out: UnifiedQualificationRow[] = [];

    for (const [key, rows] of sstBucket) {
      const integrityConflict = rows.length > 1;
      const sourceConflict = docBucket.has(key);
      for (const r of rows) {
        const t = typesById.get(r.document_type_id);
        out.push({
          id: r.id,
          workerId: r.worker_id,
          documentTypeId: r.document_type_id ?? "",
          code: t?.code ?? r.nr_code ?? "—",
          name: t?.name ?? r.nr_code ?? "—",
          category: (t?.category ?? "sst_nr") as WorkerQualificationCategory,
          storageFlow: (t?.storageFlow ?? "worker_sst_qualifications") as WorkerQualificationStorageFlow,
          source: "sst",
          issuedAt: r.issued_at,
          expiresAt: r.expires_at,
          validityStatus: r.validity_status,
          documentStatus: r.document_status,
          status: classifySst(r),
          documentUrl: r.document_url,
          filePath: r.document_url,
          revisionType: r.revision_type,
          isCurrent: true,
          sourceConflict,
          integrityConflict,
          sstRaw: r,
        });
      }
    }

    for (const [key, rows] of docBucket) {
      const integrityConflict = rows.length > 1;
      const sourceConflict = sstBucket.has(key);
      if (sourceConflict) {
        // eslint-disable-next-line no-console
        console.error("[useWorkerQualificationsUnified] source conflict — mesmo document_type_id vigente em SST e worker_documents", {
          workerId,
          documentTypeId: key,
        });
      }
      for (const r of rows) {
        const t = typesById.get(r.document_type_id);
        out.push({
          id: r.id,
          workerId: r.worker_id,
          documentTypeId: r.document_type_id,
          code: t?.code ?? "—",
          name: t?.name ?? "—",
          category: (t?.category ?? "sst_aso") as WorkerQualificationCategory,
          storageFlow: (t?.storageFlow ?? "worker_documents") as WorkerQualificationStorageFlow,
          source: "worker_documents",
          issuedAt: r.issue_date ?? r.issued_at ?? null,
          expiresAt: r.expiry_date ?? r.expires_at ?? null,
          validityStatus: null,
          documentStatus: r.status ?? null,
          status: classifyDoc(r),
          documentUrl: r.file_path ?? r.document_url ?? null,
          filePath: r.file_path ?? null,
          revisionType: null,
          isCurrent: true,
          sourceConflict,
          integrityConflict,
          docRaw: r,
        });
      }
    }

    out.sort((a, b) => {
      const pa = STATUS_ORDER.indexOf(a.status);
      const pb = STATUS_ORDER.indexOf(b.status);
      if (pa !== pb) return pa - pb;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.code.localeCompare(b.code, "pt-BR");
    });
    return out;
  }, [isLoading, error, typesQ.data, sstQ.data, docsQ.data, workerId]);

  return {
    data: rows,
    isLoading,
    error,
  };
}