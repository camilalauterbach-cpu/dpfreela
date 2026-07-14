import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ExpirationStatus = "valid" | "expiring_soon" | "expired" | "no_expiry";
export type DocumentStatus = "pending" | "ok" | "rejected" | "no_document";
export type RevisionType = "initial" | "renewal" | "replacement" | "additional";
export type SourceType = "manual" | "link_document" | "import";
export type ValidityStatus = "has_expiry" | "no_expiry" | "unknown";

export interface SstCurrentRow {
  id: string;
  worker_id: string;
  nr_code: string;
  chain_key: string;
  training_type: string | null;
  issued_at: string;
  expires_at: string | null;
  workload_hours: number | null;
  provider_name: string | null;
  instructor_name: string | null;
  document_url: string | null;
  document_status: DocumentStatus;
  validity_status: ValidityStatus;
  source_type: SourceType;
  revision_type: RevisionType;
  employment_link_document_id: string | null;
  link_group_worker_id: string | null;
  link_group_id: string | null;
  event_id: string | null;
  company_id: string | null;
  notes: string | null;
  expiration_status: ExpirationStatus;
}

export interface SstWorkerRow {
  worker_id: string;
  full_name: string;
  nickname: string | null;
  cpf: string | null;
  qualifications: SstCurrentRow[];
}

interface Filters {
  search: string;
  nr?: string;
  expiration?: "" | ExpirationStatus;
  doc?: "" | DocumentStatus;
  validity?: "" | ValidityStatus;
  /** Filtra vencendo nos próximos N dias (inclui já vencidos? — não; apenas próximos N a partir de hoje). */
  daysUntil?: number | null;
}

/** Invalida todas as queries relacionadas ao Controle SST e à listagem de docs de vínculo. */
export function invalidateSstCaches(qc: QueryClient, opts?: { linkDocsOwnerId?: string }) {
  qc.invalidateQueries({ queryKey: ["sst-qualifications"] });
  qc.invalidateQueries({ queryKey: ["sst-summary"] });
  qc.invalidateQueries({ queryKey: ["sst-worker-details"] });
  if (opts?.linkDocsOwnerId) {
    qc.invalidateQueries({ queryKey: ["link-docs", opts.linkDocsOwnerId] });
  } else {
    qc.invalidateQueries({ queryKey: ["link-docs"] });
  }
}

export function useSstOverview(filters: Filters) {
  return useQuery({
    queryKey: ["sst-qualifications", filters],
    queryFn: async () => {
      const { data: quals, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("*");
      if (error) throw error;
      const rows = (quals || []) as SstCurrentRow[];

      const workerIds = Array.from(new Set(rows.map((r) => r.worker_id)));
      if (workerIds.length === 0) return { workers: [] as SstWorkerRow[] };

      const { data: workers, error: wErr } = await supabase
        .from("workers")
        .select("id, full_name, nickname, cpf")
        .in("id", workerIds)
        .is("deleted_at", null);
      if (wErr) throw wErr;

      const byWorker = new Map<string, SstWorkerRow>();
      for (const w of workers || []) {
        byWorker.set(w.id, {
          worker_id: w.id,
          full_name: w.full_name,
          nickname: w.nickname,
          cpf: w.cpf,
          qualifications: [],
        });
      }
      for (const r of rows) {
        const w = byWorker.get(r.worker_id);
        if (w) w.qualifications.push(r);
      }

      let list = Array.from(byWorker.values());

      const term = filters.search.trim().toLowerCase();
      if (term) {
        const digits = term.replace(/\D/g, "");
        list = list.filter((w) =>
          w.full_name.toLowerCase().includes(term) ||
          (w.nickname || "").toLowerCase().includes(term) ||
          (digits && (w.cpf || "").replace(/\D/g, "").includes(digits))
        );
      }
      if (filters.nr) {
        const nr = filters.nr.toUpperCase();
        list = list.filter((w) => w.qualifications.some((q) => q.nr_code === nr));
      }
      if (filters.expiration) {
        list = list.filter((w) =>
          w.qualifications.some((q) => q.expiration_status === filters.expiration)
        );
      }
      if (filters.doc) {
        list = list.filter((w) =>
          w.qualifications.some((q) => q.document_status === filters.doc)
        );
      }
      if (filters.validity) {
        list = list.filter((w) =>
          w.qualifications.some((q) => q.validity_status === filters.validity)
        );
      }
      if (filters.daysUntil && filters.daysUntil > 0) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + filters.daysUntil);
        list = list.filter((w) =>
          w.qualifications.some((q) => {
            if (!q.expires_at) return false;
            const d = new Date(q.expires_at + "T00:00:00");
            return d >= today && d <= cutoff;
          })
        );
      }

      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
      return { workers: list };
    },
    staleTime: 60_000,
  });
}

export function useSstSummary() {
  return useQuery({
    queryKey: ["sst-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("worker_id, expiration_status, document_status");
      if (error) throw error;
      const rows = (data || []) as Array<Pick<SstCurrentRow, "worker_id" | "expiration_status" | "document_status">>;
      const workers = new Set(rows.map((r) => r.worker_id));
      let expired = 0, expiring = 0, valid = 0, pending = 0;
      for (const r of rows) {
        if (r.expiration_status === "expired") expired++;
        else if (r.expiration_status === "expiring_soon") expiring++;
        else valid++;
        if (r.document_status === "pending") pending++;
      }
      return {
        totalWorkers: workers.size,
        totalQualifications: rows.length,
        expired,
        expiring,
        valid,
        pending,
      };
    },
    staleTime: 60_000,
  });
}

export interface SstAlertCounts {
  expiredOk: number;
  expiredPending: number;
  expiringSoonOk: number;
  expiringSoonPending: number;
  pending: number;         // document_status = 'pending'
  rejected: number;        // document_status = 'rejected'
  noDocument: number;      // document_status = 'no_document'
  unknownValidity: number; // validity_status = 'unknown'
  monitoredWorkers: number;
  totalAttention: number;  // vencidas + vencendo (independente de doc)
}

/**
 * Contagens segmentadas — apenas view _current (nunca histórico).
 * Regras (banco): expired = expires_at < CURRENT_DATE;
 *                 expiring_soon = expires_at entre hoje e +30d;
 *                 no_expiry = validity_status='no_expiry' OU expires_at IS NULL;
 *                 unknown = validity_status='unknown'.
 */
export function useSstAlertCounts() {
  return useQuery({
    queryKey: ["sst-alert-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("worker_id, expiration_status, document_status, validity_status");
      if (error) throw error;
      const rows = (data || []) as Array<
        Pick<SstCurrentRow, "worker_id" | "expiration_status" | "document_status" | "validity_status">
      >;

      const c: SstAlertCounts = {
        expiredOk: 0, expiredPending: 0,
        expiringSoonOk: 0, expiringSoonPending: 0,
        pending: 0, rejected: 0, noDocument: 0, unknownValidity: 0,
        monitoredWorkers: 0, totalAttention: 0,
      };
      const workers = new Set<string>();
      for (const r of rows) {
        workers.add(r.worker_id);
        if (r.expiration_status === "expired") {
          if (r.document_status === "ok") c.expiredOk++;
          else c.expiredPending++;
          c.totalAttention++;
        } else if (r.expiration_status === "expiring_soon") {
          if (r.document_status === "ok") c.expiringSoonOk++;
          else c.expiringSoonPending++;
          c.totalAttention++;
        }
        if (r.document_status === "pending") c.pending++;
        else if (r.document_status === "rejected") c.rejected++;
        else if (r.document_status === "no_document") c.noDocument++;
        if (r.validity_status === "unknown") c.unknownValidity++;
      }
      c.monitoredWorkers = workers.size;
      return c;
    },
    staleTime: 60_000,
  });
}