// Q-024-D-UI-MULTIPLE — Drawer único para envio de certificado SST/qualificação.
// Modos: create | renew | replace. Identidade CANÔNICA por document_type_id
// (catálogo mestre `useWorkerQualificationTypes`). Nunca aceita input livre de NR.
// Fluxo: Upload Storage → register_sst_revision (com document_type_id)
//         → reevaluate_worker_links → invalidate caches.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { captureRpcFailure, copyRpcFailure, type RpcFailureBundle } from "@/lib/rpc-diagnostics";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Upload, Loader2, X, AlertTriangle, RefreshCw, Replace } from "lucide-react";
import { invalidateSstCaches, type SstCurrentRow } from "@/hooks/useSstQualifications";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";
import {
  validateUpload, getSafeContentType, ALLOWED_FILE_EXTENSIONS,
} from "@/lib/upload-validation";
import { computeCertificateExpiry } from "@/lib/sst/validity";
import {
  useWorkerQualificationTypes,
  type WorkerQualificationType,
  normalizeQualificationSearchTerm,
} from "@/hooks/useWorkerQualificationTypes";
import { QualificationDocumentTypeCombobox } from "./QualificationDocumentTypeCombobox";

export type SstDrawerMode = "create" | "renew" | "replace";

// Q-024-D-TRAINING-FIX §7 — mapeamento de erros técnicos → texto claro.
// Q-025-UX — nenhuma mensagem técnica de duplicidade pode vazar para o usuário.
const RPC_ERROR_MESSAGES: Record<string, string> = {
  invalid_nr_code_format:
    "Este tipo documental foi tratado incorretamente como NR.",
  training_document_type_id_required:
    "Selecione o treinamento no catálogo.",
  qualification_storage_flow_not_supported:
    "Este tipo deve ser cadastrado em outro fluxo documental.",
  unknown_document_type:
    "O tipo selecionado não foi encontrado no catálogo.",
  document_type_code_mismatch:
    "O tipo selecionado não corresponde ao código informado.",
  document_type_inactive:
    "Este tipo documental está inativo no catálogo.",
  qualification_current_version_exists:
    "Já existe versão vigente deste tipo. Use Renovar ou Substituir.",
  additional_conflicts_with_current:
    "Já existe versão vigente deste tipo. Use Renovar ou Substituir.",
  no_current_qualification_to_revise:
    "Nenhuma versão vigente encontrada para revisar.",
  stale_current_qualification:
    "A versão vigente mudou desde a última leitura. Recarregue e tente novamente.",
  invariant_violation_multiple_current_qualifications:
    "Conflito de integridade: mais de uma versão vigente. Contate o administrador.",
  invalid_expiry:
    "Data de validade inválida — deve ser posterior à realização.",
  renewal_same_period_use_correction:
    "As datas informadas são idênticas à vigência atual. Para corrigir o certificado vigente, use Substituir (não Renovar).",
  document_type_not_sst_or_training:
    "Este tipo documental não é aceito no cadastro de qualificações (apenas NRs e Treinamentos).",
  document_type_not_sst_nr:
    "Este tipo documental não é aceito no cadastro de qualificações (apenas NRs e Treinamentos).",
};

// Padrões "técnicos" que jamais devem chegar ao usuário como estão. A lista é
// intencionalmente ampla: cobre erros do Postgres (SQLSTATE, restrições,
// gatilhos, PL/pgSQL), do PostgREST/Supabase (códigos PGRST*, hints, "Results
// contain 0 rows"), da camada HTTP (status técnicos) e do runtime JS
// (TypeError, stack traces). Qualquer expressão nova identificada em produção
// deve ser acrescentada aqui com um teste de regressão em
// `mapRpcError.test.ts`.
const TECHNICAL_PATTERNS: RegExp[] = [
  // Postgres — restrições e integridade
  /duplicate key/i,
  /unique constraint/i,
  /check constraint/i,
  /foreign key/i,
  /not[- ]null constraint/i,
  /null value in column/i,
  /violates/i,
  /exclusion constraint/i,
  /conflict on constraint/i,
  // Postgres — códigos SQLSTATE e ERRCODE
  /sqlstate/i,
  /errcode/i,
  /\bP0001\b/,
  /\b23\d{3}\b/, // 23xxx integrity_constraint_violation
  /\b22\d{3}\b/, // 22xxx data_exception
  /\b40\d{3}\b/, // 40xxx transaction rollback (deadlock/serialize)
  /\b42\d{3}\b/, // 42xxx syntax/access
  /\b42P\d{2}\b/i,
  // Postgres — objetos/nomes internos
  /uq_worker_sst/i,
  /pg[a-z_]*:/i,
  /pg_[a-z_]+/i,
  /\bpq:\s/i,
  /relation "[^"]+" does not exist/i,
  /column "[^"]+" does not exist/i,
  /function [a-z0-9_.]+\([^)]*\) does not exist/i,
  /operator does not exist/i,
  /invalid input syntax for type/i,
  /syntax error at or near/i,
  /deadlock detected/i,
  /could not serialize access/i,
  /permission denied for/i,
  /schema "[^"]+"/i,
  /raise exception/i,
  /CONTEXT:\s*PL\/pgSQL/i,
  /QUERY:\s/i,
  /HINT:\s/i,
  /DETAIL:\s/i,
  // PostgREST / Supabase
  /PGRST\d+/i,
  /postgrest/i,
  /supabase/i,
  /JWT (?:expired|malformed|invalid)/i,
  /Results contain \d+ rows/i,
  /no rows returned/i,
  // HTTP / infraestrutura
  /\bHTTP\s+\d{3}\b/i,
  /status(?: code)?\s*[:=]\s*\d{3}/i,
  /\bECONN[A-Z]+\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  // Runtime JS
  /TypeError:/,
  /ReferenceError:/,
  /SyntaxError:/,
  /RangeError:/,
  /\bundefined is not\b/i,
  /cannot read propert(?:y|ies) of (?:null|undefined)/i,
  /\bat\s+\S+\s+\([^)]*:\d+:\d+\)/, // stack frames
];

/**
 * Verdadeiro quando o texto tem aparência de erro técnico (SQL, PostgREST,
 * stack trace, etc.) e nunca deve ser exibido ao usuário como está.
 * Exportado para permitir testes de regressão diretos.
 */
export function looksTechnical(raw: string): boolean {
  if (!raw) return false;
  return TECHNICAL_PATTERNS.some((rx) => rx.test(raw));
}

export interface MapRpcErrorCtx {
  mode: SstDrawerMode;
  /** Categoria do document_type selecionado (sst_nr | sst_aso | training | null). */
  category?: string | null;
}

/**
 * Traduz mensagens da RPC/Postgres em texto claro e sem jargão. Nunca deixa
 * vazar erro técnico de duplicidade (23505/uq_worker_sst/duplicate key) — a
 * orientação depende do modo (Renovar vs Cadastrar/Substituir) e da categoria
 * do tipo escolhido (NR × ASO × Treinamento).
 */
export function mapRpcError(raw: string, ctx: MapRpcErrorCtx): string {
  const lower = raw.toLowerCase();

  // 1) Códigos canônicos da RPC — com refinamento sensível ao contexto.
  for (const [code, text] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (!lower.includes(code)) continue;

    if (code === "qualification_current_version_exists" || code === "additional_conflicts_with_current") {
      if (ctx.mode === "renew") {
        return "As datas informadas correspondem à vigência atual. Para corrigir o certificado vigente, use Substituir (não Renovar).";
      }
      if (ctx.mode === "replace") {
        return "A versão vigente mudou desde a última leitura. Recarregue a página e tente Substituir novamente.";
      }
      return text;
    }

    if (code === "document_type_not_sst_or_training" || code === "document_type_not_sst_nr") {
      if (ctx.category === "sst_aso") {
        return "ASO não é cadastrado aqui. Gerencie o ASO pela aba Documentos do trabalhador.";
      }
      return "Este tipo documental não é aceito neste cadastro. Selecione uma NR ou um Treinamento.";
    }

    if (code === "invalid_nr_code_format" && ctx.category && ctx.category !== "sst_nr") {
      return "O tipo selecionado não é uma NR. Escolha uma NR válida ou um Treinamento.";
    }

    return text;
  }

  // 2) Assinaturas de duplicidade "cruas" do Postgres — nunca expor ao usuário.
  if (
    lower.includes("duplicate key") ||
    lower.includes("unique constraint") ||
    lower.includes("uq_worker_sst") ||
    lower.includes(" 23505") ||
    lower.startsWith("23505")
  ) {
    if (ctx.mode === "renew") {
      return "As datas informadas correspondem à vigência atual. Para corrigir o certificado vigente, use Substituir (não Renovar).";
    }
    return "Já existe uma versão vigente deste tipo. Use Renovar (para uma nova vigência) ou Substituir (para corrigir a atual).";
  }

  // 3) Qualquer outro erro tipicamente técnico → mensagem genérica cordial.
  if (looksTechnical(raw)) {
    return "Não foi possível salvar o certificado. Recarregue a página e tente novamente.";
  }

  return raw;
}

// Q-024-D-TRAINING-FIX §6 — opções controladas de `training_type`.
const TRAINING_TYPE_OPTIONS = [
  "Inicial",
  "Reciclagem",
  "Atualização",
  "Complementar",
  "Outro",
] as const;

// Q-024-D-UI-MULTIPLE — variável da mutation com a intenção do usuário.
// Não depende de state atualizado assincronamente antes de submit.mutate().
export interface SubmitVars {
  continueAdding: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: SstDrawerMode;
  workerId: string;
  workerName: string;
  /** Obrigatório em renew/replace; opcional em create (row com NR conhecida) */
  current?: SstCurrentRow | null;
  /** document_type_id pré-selecionado (renew/replace, ou create a partir de row) */
  presetDocumentTypeId?: string | null;
  /** Compat: NR pré-selecionada (legado — resolvido para document_type_id) */
  presetNrCode?: string | null;
  /** Tipos já vigentes do trabalhador — exibidos como "Já cadastrada". */
  currentByDocumentTypeId?: Set<string>;
  /** Quando o usuário decide renovar/substituir um tipo já cadastrado. */
  onRequestRenew?: (row: SstCurrentRow) => void;
  onRequestReplace?: (row: SstCurrentRow) => void;
  /** Qualificações vigentes (para localizar a linha ao oferecer renew/replace). */
  currentRows?: SstCurrentRow[];
  /** ASO/worker_documents: navegar até a aba Documentos. */
  onManageInDocuments?: (documentTypeId: string) => void;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

const TITLES: Record<SstDrawerMode, string> = {
  create: "Adicionar qualificação",
  renew: "Renovar certificado",
  replace: "Substituir certificado",
};

const DESCRIPTIONS: Record<SstDrawerMode, string> = {
  create: "Registrar uma nova NR, ASO ou treinamento para este trabalhador.",
  renew: "Nova revisão na mesma cadeia — a anterior vira histórico.",
  replace: "Encerra a atual e cria nova revisão. O histórico é preservado.",
};

export function SstCertificateDrawer({
  open, onOpenChange, mode, workerId, workerName, current,
  presetDocumentTypeId, presetNrCode, currentByDocumentTypeId,
  onRequestRenew, onRequestReplace, currentRows, onManageInDocuments,
}: Props) {
  const qc = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [selectedDocumentTypeId, setSelectedDocumentTypeId] = useState<string | null>(null);
  const [trainingType, setTrainingType] = useState("");
  const [trainingTypeOther, setTrainingTypeOther] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [hasExpiry, setHasExpiry] = useState(true);
  // Sinaliza que o usuário editou o vencimento manualmente — evita
  // sobrescrever o valor ao recalcular a partir da NR/data de realização.
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [workload, setWorkload] = useState("");
  const [provider, setProvider] = useState("");
  const [instructor, setInstructor] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const typeLocked = mode !== "create";

  // Catálogo canônico (Q-024.A) — fonte única de tipos elegíveis.
  const { data: types, isLoading: loadingTypes } = useWorkerQualificationTypes({ includeInactive: false });
  const typesById = useMemo(() => {
    const m = new Map<string, WorkerQualificationType>();
    for (const t of types ?? []) m.set(t.documentTypeId, t);
    return m;
  }, [types]);
  const selectedType: WorkerQualificationType | null =
    (selectedDocumentTypeId && typesById.get(selectedDocumentTypeId)) || null;
  const defaultValidityDays = selectedType?.defaultValidityDays ?? null;

  // Resolver presetNrCode legado → document_type_id via catálogo canônico.
  const resolvePresetId = (): string | null => {
    if (presetDocumentTypeId) return presetDocumentTypeId;
    if (!presetNrCode) return null;
    // Q-024-D-UI-MULTIPLE §8 — normalizador canônico compartilhado do catálogo.
    const compact = normalizeQualificationSearchTerm(presetNrCode).replace(/\s+/g, "");
    const found = (types ?? []).find((t) => t.normalizedCode === compact);
    return found?.documentTypeId ?? null;
  };

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setNotes("");
    setLastError(null);
    setExpiryTouched(false);
    if (mode === "create") {
      setSelectedDocumentTypeId(resolvePresetId());
      setTrainingType("");
      setTrainingTypeOther("");
      setIssuedAt("");
      setExpiresAt("");
      setHasExpiry(true);
      setWorkload("");
      setProvider("");
      setInstructor("");
    } else if (current) {
      setSelectedDocumentTypeId(current.document_type_id ?? resolvePresetId());
      setTrainingType(current.training_type || "");
      setIssuedAt("");
      setExpiresAt("");
      setHasExpiry(current.validity_status !== "no_expiry");
      setWorkload(current.workload_hours ? String(current.workload_hours) : "");
      setProvider(current.provider_name || "");
      setInstructor(current.instructor_name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, current, presetDocumentTypeId, presetNrCode]);

  // Resolve preset → document_type_id quando o catálogo carrega tardiamente.
  // Não toca em nenhum outro campo para evitar apagar o que o usuário digitou.
  useEffect(() => {
    if (!open) return;
    if (selectedDocumentTypeId) return;
    const resolved = resolvePresetId();
    if (resolved) setSelectedDocumentTypeId(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, types, presetDocumentTypeId, presetNrCode]);

  // Cálculo automático do vencimento: só se o usuário não tiver editado.
  useEffect(() => {
    if (!open || !hasExpiry || expiryTouched || !issuedAt) return;
    const { expiresAt: auto } = computeCertificateExpiry({
      issuedAt,
      hasExpiry: true,
      defaultValidityDays,
    });
    if (auto) setExpiresAt(auto);
  }, [open, hasExpiry, expiryTouched, issuedAt, defaultValidityDays]);

  // Se o usuário alternar para "Sem vencimento", limpa e reseta o toque manual.
  useEffect(() => {
    if (!hasExpiry) {
      setExpiresAt("");
      setExpiryTouched(false);
    }
  }, [hasExpiry]);

  const today = new Date().toISOString().slice(0, 10);

  const alreadyRegistered =
    mode === "create" && selectedDocumentTypeId
      ? currentByDocumentTypeId?.has(selectedDocumentTypeId) ?? false
      : false;
  const existingRow: SstCurrentRow | null = alreadyRegistered && currentRows
    ? currentRows.find((r) => r.document_type_id === selectedDocumentTypeId) ?? null
    : null;

  const storageFlow = selectedType?.storageFlow ?? null;
  const flowBlocked = storageFlow === "worker_documents" || storageFlow === "unresolved";

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!selectedDocumentTypeId) errs.push("Selecione o tipo (NR, ASO ou treinamento).");
    if (selectedType && !selectedType.isActive) errs.push("Tipo selecionado está inativo.");
    if (mode === "create" && alreadyRegistered) {
      errs.push("Este tipo já possui uma qualificação vigente. Use Renovar ou Substituir.");
    }
    if (flowBlocked) {
      // Bloqueado antes de validar arquivo — evita ruído de mensagens.
      return errs;
    }
    if (!file) errs.push("Selecione o arquivo do certificado.");
    if (!issuedAt) errs.push("Informe a data de realização/conclusão.");
    else if (issuedAt > today) errs.push("Realização não pode ser futura.");
    if (hasExpiry) {
      if (!expiresAt) errs.push("Informe a data de validade.");
      else if (issuedAt && expiresAt <= issuedAt)
        errs.push("Validade deve ser posterior à realização.");
      else if (expiresAt <= today)
        errs.push("Validade deve ser posterior a hoje.");
    }
    return errs;
  }, [
    file, selectedDocumentTypeId, selectedType, mode, alreadyRegistered, flowBlocked,
    issuedAt, expiresAt, hasExpiry, today,
  ]);

  const canSubmit = errors.length === 0 && !uploading && !flowBlocked;

  const submit = useMutation({
    mutationFn: async (_vars: SubmitVars = { continueAdding: false }) => {
      if (!file) throw new Error("no_file");
      if (!selectedType) throw new Error("no_type_selected");
      const normalized = selectedType.code;
      const validationError = validateUpload(file);
      if (validationError) throw new Error(validationError);

      // 1) Upload
      setUploading(true);
      setLastError(null);
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      // Timestamp ISO compacto (YYYYMMDDTHHMMSSZ) — legível durante inspeções.
      const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace(/\..+$/, "").slice(0, 15) + "Z";
      const opTag =
        mode === "renew" ? "renewal" :
        mode === "replace" ? "replacement" : "initial";
      const path = `sst/${workerId}/${normalized}/${stamp}_${opTag}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, file, {
          upsert: false,
          contentType: getSafeContentType(file),
        });
      setUploading(false);
      if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

      // 2) register_sst_revision
      const operation =
        mode === "renew" ? "renewal" :
        mode === "replace" ? "correction" :
        "initial";

      const payload: Record<string, unknown> = {
        worker_id: workerId,
        // Q-024-D-TRAINING-FIX §3: identidade canônica pelo UUID. `nr_code` só
        // acompanha o payload para category='sst_nr' — a RPC ignora o campo em
        // treinamento, mas evitamos disparar `invalid_nr_code_format` no backend
        // não enviando um valor não-NR.
        document_type_id: selectedType.documentTypeId,
        ...(selectedType.category === "sst_nr" ? { nr_code: normalized } : {}),
        operation,
        previous_qualification_id:
          (mode === "renew" || mode === "replace") ? current?.id ?? null : null,
        expected_current_qualification_id:
          (mode === "renew" || mode === "replace") ? current?.id ?? null : null,
        training_type:
          trainingType === "Outro"
            ? (trainingTypeOther.trim() || null)
            : (trainingType.trim() || null),
        issued_at: issuedAt,
        expires_at: hasExpiry ? expiresAt : null,
        validity_status: hasExpiry ? "has_expiry" : "no_expiry",
        workload_hours: workload ? Number(workload) : null,
        provider_name: provider.trim() || null,
        instructor_name: instructor.trim() || null,
        notes: notes.trim() || null,
        source_type: "manual",
        document_url: path,
        document_status: "ok",
      };
      const { error: rpcErr } = await (supabase as any).rpc(
        "register_sst_revision",
        { payload },
      );
      if (rpcErr) {
        // Q-024-D-DIAG — captura estruturada da falha da RPC (request/response
        // + document_type_id + categoria + bundle version) para viabilizar
        // decisão de gate da E-DOC.2.A sem depender do DevTools do operador.
        const bundle = captureRpcFailure({
          rpc: "register_sst_revision",
          payload,
          error: rpcErr,
          context: {
            worker_id: workerId,
            worker_name: workerName,
            mode,
            operation,
            document_type_id: selectedType.documentTypeId,
            document_type_code: normalized,
            document_type_category: selectedType.category,
            file_name: file?.name ?? null,
            file_size: file?.size ?? null,
            storage_path: path,
          },
        });
        // rollback do arquivo — evita órfão no bucket
        await supabase.storage.from("worker-documents").remove([path]).catch(() => {});
        const err = new Error(String(rpcErr.message || "Falha ao registrar revisão."));
        (err as any).diagnostic = bundle;
        throw err;
      }

      // 3) reevaluate_worker_links (retorna contagem)
      const reeval = await (supabase as any).rpc(
        "reevaluate_worker_links",
        { p_worker_id: workerId, p_event_source: "upload" },
      );
      const reevalError = reeval?.error ?? null;
      const linksProcessed = Number(reeval?.data?.links_processed ?? 0);
      return { normalized, linksProcessed, reevalError };
    },
    onSuccess: (res, vars) => {
      // 4) Invalidação de caches — KPIs, tabela, histórico, vínculos, pendências
      invalidateSstCaches(qc);
      invalidateComplianceCaches(qc, { workerId, eventSource: "upload" });
      qc.invalidateQueries({ queryKey: ["worker-sst-current", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-summary", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-history", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-links-using", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] });

      const verb =
        mode === "renew" ? "renovada" :
        mode === "replace" ? "substituída" :
        "cadastrada";
      if (res.reevalError) {
        // Q-024-D-UI-MULTIPLE — reavaliação falhou: NÃO repetir upload nem revisão.
        toast.warning(
          `Certificado salvo, mas os vínculos não puderam ser reavaliados.`,
          {
            action: {
              label: "Tentar reavaliar novamente",
              onClick: async () => {
                const retry = await (supabase as any).rpc(
                  "reevaluate_worker_links",
                  { p_worker_id: workerId, p_event_source: "manual_retry" },
                );
                if (retry?.error) {
                  toast.error("Reavaliação falhou novamente. Verifique com o administrador.");
                } else {
                  toast.success("Vínculos reavaliados.");
                  invalidateSstCaches(qc);
                invalidateComplianceCaches(qc, { workerId, eventSource: "upload" });
                }
              },
            },
          },
        );
      } else {
        const linkMsg = res.linksProcessed > 0
          ? ` ${res.linksProcessed} vínculo${res.linksProcessed === 1 ? "" : "s"} reavaliado${res.linksProcessed === 1 ? "" : "s"} automaticamente.`
          : "";
        toast.success(`${res.normalized} ${verb} com sucesso.${linkMsg}`);
      }

      if (mode === "create" && vars.continueAdding) {
        // "Salvar e adicionar outra": limpa formulário e mantém drawer aberto.
        setSelectedDocumentTypeId(null);
        setFile(null);
        setTrainingType("");
        setTrainingTypeOther("");
        setIssuedAt("");
        setExpiresAt("");
        setHasExpiry(true);
        setExpiryTouched(false);
        setWorkload("");
        setProvider("");
        setInstructor("");
        setNotes("");
      } else {
        onOpenChange(false);
      }
    },
    onError: (e: any) => {
      setUploading(false);
      const raw = String(e?.message || "Falha ao registrar certificado.");
      // Q-024-D-TRAINING-FIX §7: mapear códigos técnicos para texto claro.
      const friendly = mapRpcError(raw, {
        mode,
        category: selectedType?.category ?? null,
      });
      setLastError(friendly);
      const bundle: RpcFailureBundle | undefined = e?.diagnostic;
      const description = bundle
        ? `Diagnóstico #${bundle.id} (${bundle.bundle_version})`
        : undefined;
      toast.error(friendly, {
        description,
        action: bundle
          ? {
              label: "Copiar diagnóstico",
              onClick: async () => {
                const ok = await copyRpcFailure(bundle);
                if (ok) toast.success(`Diagnóstico #${bundle.id} copiado.`);
                else toast.error("Não foi possível copiar. Veja o console (rpc-failure).");
              },
            }
          : {
              label: "Tentar novamente",
              onClick: () => submit.mutate({ continueAdding: false }),
            },
      });
    },
  });

  const pending = submit.isPending || uploading;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!pending) onOpenChange(v); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (pending) e.preventDefault(); }}
        onInteractOutside={(e) => { if (pending) e.preventDefault(); }}
        data-testid="sst-certificate-drawer"
      >
        <SheetHeader>
          <SheetTitle>{TITLES[mode]}{selectedType ? ` — ${selectedType.code}` : ""}</SheetTitle>
          <SheetDescription>
            {workerName} • {DESCRIPTIONS[mode]}
          </SheetDescription>
        </SheetHeader>

        {mode === "replace" && current && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">
              Substituindo
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">NR</div>
                <div className="font-medium">{current.nr_code}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Emitido em</div>
                <div className="font-medium">{fmtDate(current.issued_at)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Validade</div>
                <div className="font-medium">{fmtDate(current.expires_at)}</div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-4">
          {/* Seletor canônico de tipo (NR/ASO/Treinamento). */}
          <div>
            <Label>Tipo *</Label>
            <QualificationDocumentTypeCombobox
              value={selectedDocumentTypeId}
              onChange={(id) => setSelectedDocumentTypeId(id)}
              currentByDocumentTypeId={currentByDocumentTypeId}
              disabled={typeLocked || pending || loadingTypes}
              invalid={!selectedDocumentTypeId}
            />
            {selectedType && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selectedType.name} • Categoria:{" "}
                {selectedType.category === "sst_nr" ? "NR" :
                 selectedType.category === "sst_aso" ? "ASO" : "Treinamento"}
              </p>
            )}
          </div>

          {/* Alerta: tipo já cadastrado (create). */}
          {mode === "create" && alreadyRegistered && existingRow && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium text-amber-700 dark:text-amber-400">
                    Este tipo já está cadastrado
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Vigente até {fmtDate(existingRow.expires_at)}. Para atualizar, use
                    Renovar ou Substituir — não é possível criar uma segunda revisão
                    vigente do mesmo tipo.
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {onRequestRenew && (
                  <Button size="sm" variant="outline"
                    onClick={() => onRequestRenew(existingRow)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Renovar
                  </Button>
                )}
                {onRequestReplace && (
                  <Button size="sm" variant="outline"
                    onClick={() => onRequestReplace(existingRow)}>
                    <Replace className="h-3 w-3 mr-1" /> Substituir
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Fluxo de armazenamento não-worker_sst_qualifications. */}
          {flowBlocked && (
            <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0 text-xs">
                  {storageFlow === "worker_documents" ? (
                    <>
                      <div className="font-medium text-blue-700 dark:text-blue-400">
                        Este tipo deve ser cadastrado como documento do trabalhador
                      </div>
                      <div className="text-muted-foreground">
                        Use a aba <strong>Documentos</strong> para anexar o ASO. Ele não é
                        gravado no registro de NRs para preservar a fonte única de dados.
                      </div>
                      {onManageInDocuments && selectedType && (
                        <Button
                          size="sm" variant="outline" className="mt-2"
                          onClick={() => onManageInDocuments(selectedType.documentTypeId)}
                          data-testid="drawer-manage-in-documents"
                        >
                          Gerenciar na aba Documentos
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-blue-700 dark:text-blue-400">
                        Fluxo de armazenamento ainda não configurado
                      </div>
                      <div className="text-muted-foreground">
                        Este tipo aparece no catálogo mas ainda não tem escopo definido.
                        Solicite a configuração ao administrador.
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Upload */}
          <div className={flowBlocked ? "opacity-50 pointer-events-none" : ""}>
            <Label>Arquivo do certificado *</Label>
            {!file ? (
              <label
                className="mt-1 flex flex-col items-center justify-center gap-1 border border-dashed rounded-md p-4 cursor-pointer hover:bg-muted/50 text-sm text-muted-foreground"
              >
                <Upload className="h-4 w-4" />
                Selecionar arquivo (PDF, JPG, PNG, WebP — máx. 10 MB)
                <input
                  type="file"
                  accept={ALLOWED_FILE_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const err = validateUpload(f);
                    if (err) { toast.error(err); return; }
                    setFile(f);
                  }}
                />
              </label>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">✔ Pronto para envio:</span>{" "}
                    {file.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setFile(null)} disabled={pending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className={"grid grid-cols-2 gap-3 " + (flowBlocked ? "opacity-50 pointer-events-none" : "")}>
            <div>
              <Label>Tipo</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={
                  trainingType === "" || TRAINING_TYPE_OPTIONS.includes(trainingType as typeof TRAINING_TYPE_OPTIONS[number])
                    ? trainingType
                    : "Outro"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setTrainingType(v);
                  if (v !== "Outro") setTrainingTypeOther("");
                }}
                data-testid="training-type-select"
              >
                <option value="">Selecione…</option>
                {TRAINING_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {trainingType === "Outro" && (
                <Input
                  className="mt-1"
                  value={trainingTypeOther}
                  onChange={(e) => setTrainingTypeOther(e.target.value)}
                  placeholder="Descreva o tipo"
                />
              )}
            </div>
            <div>
              <Label>Data de realização/conclusão *</Label>
              <Input
                type="date" max={today} value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Validade</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={hasExpiry ? "has_expiry" : "no_expiry"}
                onChange={(e) => setHasExpiry(e.target.value === "has_expiry")}
              >
                <option value="has_expiry">Possui vencimento</option>
                <option value="no_expiry">Sem vencimento</option>
              </select>
            </div>
            {hasExpiry && (
              <div className="col-span-2">
                <Label>Data de vencimento *</Label>
                <Input
                  type="date" min={issuedAt || undefined}
                  value={expiresAt}
                  onChange={(e) => {
                    setExpiresAt(e.target.value);
                    setExpiryTouched(true);
                  }}
                />
                {issuedAt && hasExpiry && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {expiryTouched ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        Data ajustada manualmente.
                      </span>
                    ) : defaultValidityDays && expiresAt ? (
                      <>
                        Vencimento calculado automaticamente:{" "}
                        <strong>{fmtDate(expiresAt)}</strong> — {defaultValidityDays} dias após a realização.
                      </>
                    ) : !defaultValidityDays ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        Este tipo não possui validade padrão configurada. Informe o vencimento manualmente.
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            )}
            <div>
              <Label>Carga horária</Label>
              <Input
                value={workload}
                inputMode="numeric"
                onChange={(e) => setWorkload(e.target.value.replace(/\D/g, ""))}
                placeholder="Horas (inteiro)"
              />
            </div>
            <div>
              <Label>Instituição</Label>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Instrutor</Label>
              <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          {lastError && !pending && (
            (() => {
              const sameDatesConflict =
                mode === "renew" &&
                /Substituir/i.test(lastError) &&
                !!current &&
                !!onRequestReplace;
              return (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start justify-between gap-2"
                  data-testid="sst-drawer-error"
                >
                  <span className="min-w-0">{lastError}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {sameDatesConflict && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        data-testid="sst-drawer-switch-to-replace"
                        onClick={() => onRequestReplace!(current!)}
                      >
                        <Replace className="h-3 w-3 mr-1" /> Ir para Substituir
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => submit.mutate({ continueAdding: false })}
                      disabled={errors.length > 0}
                    >
                      Tentar novamente
                    </Button>
                  </div>
                </div>
              );
            })()
          )}
        </div>

        <SheetFooter className="mt-6 gap-2 sm:justify-end flex-wrap">
          <Button
            variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}
          >
            Cancelar
          </Button>
          {mode === "create" && (
            <Button
              variant="outline"
              onClick={() => submit.mutate({ continueAdding: true })}
              disabled={!canSubmit}
              data-testid="save-and-add-another"
            >
              {pending && submit.variables?.continueAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar e adicionar outra
            </Button>
          )}
          <Button
            onClick={() => submit.mutate({ continueAdding: false })}
            disabled={!canSubmit}
            data-testid="save-qualification"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {uploading ? "Enviando arquivo…" : submit.isPending ? "Registrando…" :
              mode === "renew" ? "Renovar" : mode === "replace" ? "Substituir" : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}