import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, Plus, RefreshCw, Replace, History, Users, MoreHorizontal, GitBranch,
  FileText, ExternalLink, ShieldCheck, FolderOpen, Trash2, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useWorkerSstSummary,
} from "@/hooks/useWorkerSst";
import {
  useWorkerQualificationsUnified,
  type UnifiedQualificationRow,
} from "@/hooks/useWorkerQualificationsUnified";
import type { SstCurrentRow } from "@/hooks/useSstQualifications";
import {
  SstStatusBadge, type SstOverallStatus, daysUntil,
} from "./SstStatusBadge";
import { SstHistorySheet } from "./SstHistorySheet";
import { SstLinksUsingSheet } from "./SstLinksUsingSheet";
import { SstNrTimeline } from "./SstNrTimeline";
import { SstCertificateDrawer, type SstDrawerMode } from "./SstCertificateDrawer";
import { AsoValidityDialog } from "./AsoValidityDialog";
import { openCertificate } from "@/lib/sst/certificate-url";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { invalidateSstCaches } from "@/hooks/useSstQualifications";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

async function runStorageCleanup(
  paths: string[],
  jobIds: string[],
  traceId: string,
): Promise<{ requested: number; completed: number; failed: number; error?: string }> {
  if (paths.length === 0) return { requested: 0, completed: 0, failed: 0 };
  let error: string | undefined;
  let rmErr: { message: string } | null = null;
  try {
    const res = await supabase.storage.from("worker-documents").remove(paths);
    rmErr = res.error ?? null;
  } catch (e: any) {
    rmErr = { message: String(e?.message || e) };
  }
  if (rmErr) {
    error = rmErr.message;
    // eslint-disable-next-line no-console
    console.warn("[sst-hard-delete] storage_cleanup_failed", { traceId, error, jobIds });
  }
  let completed = 0, failed = 0;
  await Promise.all(
    jobIds.map(async (id) => {
      const { error: mkErr } = await (supabase as any).rpc("mark_storage_cleanup_job_status", {
        p_id: id,
        p_status: rmErr ? "failed" : "completed",
        p_error: rmErr ? rmErr.message : null,
      });
      if (mkErr) {
        // eslint-disable-next-line no-console
        console.warn("[sst-hard-delete] mark_job_failed", { traceId, id, error: mkErr.message });
      }
      if (rmErr) failed += 1; else completed += 1;
    }),
  );
  return { requested: paths.length, completed, failed, error };
}

function KpiCard({
  label, value, tone, testId,
}: { label: string; value: number; tone: string; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${tone}`} data-testid={testId ? `${testId}-value` : undefined}>{value}</p>
      </CardContent>
    </Card>
  );
}

interface Props {
  workerId: string;
  workerName: string;
}

export function SstQualificationsPanel({ workerId, workerName }: Props) {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const canDelete = hasAnyRole(["admin", "manager", "operator"]);
  const { data: unified, isLoading } = useWorkerQualificationsUnified(workerId);
  const { data: summary, isLoading: loadingSummary } = useWorkerSstSummary(workerId);

  const [historyOpen, setHistoryOpen] = useState<{ nr: string; documentTypeId: string } | null>(null);
  const [linksOpen, setLinksOpen] = useState<{ nr: string; docTypeId: string | null } | null>(null);
  const [timelineOpen, setTimelineOpen] = useState<{ nr: string; docTypeId: string } | null>(null);
  const [drawer, setDrawer] = useState<
    {
      mode: SstDrawerMode;
      current: SstCurrentRow | null;
      presetDocumentTypeId: string | null;
      presetNrCode: string | null;
    } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; code: string; issuedAt: string | null } | null
  >(null);
  const [asoValidity, setAsoValidity] = useState<
    | {
        documentId: string;
        documentTypeId: string;
        code: string;
        issuedAt: string | null;
        expiresAt: string | null;
      }
    | null
  >(null);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const traceId = `del-${id.slice(0, 8)}-${Date.now().toString(36)}`;
      const before = summary
        ? {
            expired: summary.expired,
            expiringSoon: summary.expiringSoon,
            valid: summary.valid,
            pendingDocs: summary.pendingDocs,
          }
        : null;
      // eslint-disable-next-line no-console
      console.info("[sst-hard-delete] start", {
        traceId, workerId, qualificationId: id, summaryBefore: before,
      });
      const t0 = performance.now();
      const { data, error } = await (supabase as any).rpc("hard_delete_sst_chain", {
        p_qualification_id: id,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[sst-hard-delete] rpc_error", {
          traceId, qualificationId: id, error: error.message, code: (error as any).code,
        });
        throw error;
      }
      const storagePaths: string[] = Array.isArray((data as any)?.storage_paths)
        ? ((data as any).storage_paths as string[]).filter((p) => typeof p === "string" && p.length > 0)
        : [];
      const cleanupJobIds: string[] = Array.isArray((data as any)?.cleanup_job_ids)
        ? ((data as any).cleanup_job_ids as string[]).filter((s) => typeof s === "string" && s.length > 0)
        : [];
      // Limpeza best-effort do Storage. Falha NUNCA ressuscita a NR — os jobs
      // permanecem pending/failed na fila e podem ser reprocessados.
      const cleanupOutcome = await runStorageCleanup(storagePaths, cleanupJobIds, traceId);
      // Reavalia vínculos após exclusão para recalcular indicadores.
      await (supabase as any).rpc("reevaluate_worker_links", {
        p_worker_id: workerId,
        p_event_source: "hard_delete_sst_chain",
      });
      // eslint-disable-next-line no-console
      console.info("[sst-hard-delete] rpc_ok", {
        traceId, qualificationId: id, elapsedMs: Math.round(performance.now() - t0),
        deleted_qualification_ids: (data as any)?.deleted_qualification_ids,
        deleted_worker_document_ids: (data as any)?.deleted_worker_document_ids,
        storage_paths_total: storagePaths.length,
        storage_cleanup: cleanupOutcome,
      });
      return { traceId, before };
    },
    onSuccess: async (ctx) => {
      // Aguarda TODAS as invalidações/refetches antes de fechar o diálogo,
      // garantindo que a UI só sinaliza conclusão após a atualização real.
      await Promise.all([
        invalidateSstCaches(qc),
        invalidateComplianceCaches(qc, { workerId, eventSource: "admin_update" }),
        qc.invalidateQueries({ queryKey: ["worker-sst-current", workerId] }),
        qc.invalidateQueries({ queryKey: ["worker-sst-summary", workerId] }),
        qc.invalidateQueries({ queryKey: ["worker-sst-history", workerId] }),
        qc.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] }),
        qc.invalidateQueries({ queryKey: ["storage-cleanup-jobs-pending"] }),
      ]);
      // eslint-disable-next-line no-console
      console.info("[sst-hard-delete] caches_invalidated", {
        traceId: ctx?.traceId, workerId, summaryBefore: ctx?.before,
      });
      toast.success("Certificado excluído definitivamente.");
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast.error(String(e?.message || "Falha ao excluir certificado."));
    },
  });

  // Jobs de limpeza pendentes (visível para admin/manager/operator).
  // Consulta direta à tabela (RLS restringe leitura por papel) para derivar
  // as fases humanas: aguardando janela, elegível, esgotado, concluído, falhou.
  type CleanupJobRow = {
    id: string;
    bucket: string;
    path: string;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string | null;
    completed_at: string | null;
    last_error: string | null;
  };
  type CleanupPhase = "due" | "waiting" | "exhausted" | "completed" | "failed";
  const cleanupJobsQuery = useQuery({
    queryKey: ["storage-cleanup-jobs"],
    enabled: canDelete,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_document_storage_cleanup_jobs")
        .select("id,bucket,path,status,attempts,max_attempts,next_attempt_at,completed_at,last_error")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CleanupJobRow[];
    },
  });
  const phaseOf = (j: CleanupJobRow, nowMs: number): CleanupPhase => {
    if (j.status === "completed") return "completed";
    if (j.attempts >= j.max_attempts || j.next_attempt_at === null) {
      return j.status === "failed" || j.attempts >= j.max_attempts ? "exhausted" : "failed";
    }
    const nextMs = new Date(j.next_attempt_at).getTime();
    if (Number.isFinite(nextMs) && nextMs > nowMs) return "waiting";
    return "due";
  };
  const nowMs = Date.now();
  const phaseCounts = useMemo(() => {
    const acc: Record<CleanupPhase, number> = { due: 0, waiting: 0, exhausted: 0, completed: 0, failed: 0 };
    for (const j of cleanupJobsQuery.data ?? []) acc[phaseOf(j, nowMs)] += 1;
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupJobsQuery.data]);
  const pendingCount = phaseCounts.due + phaseCounts.waiting + phaseCounts.exhausted;

  const retryMut = useMutation({
    mutationFn: async (opts: { dryRun?: boolean } = {}) => {
      // Elegibilidade real é decidida no banco (claim atômico); evitamos short-circuit
      // no cliente para não ignorar jobs elegíveis que apareceram após a última query.
      // Backend Edge Function usa service_role para remover objetos do Storage
      // e atualizar o status dos jobs em worker_document_storage_cleanup_jobs.
      const { data, error } = await supabase.functions.invoke("storage-cleanup-process", {
        body: { limit: 50, dryRun: !!opts.dryRun },
      });
      if (error) throw error;
      return {
        completed: (data as any)?.completed ?? 0,
        failed: (data as any)?.failed ?? 0,
        dryRun: !!(data as any)?.dryRun,
        requested: (data as any)?.requested ?? 0,
        jobs: ((data as any)?.jobs ?? []) as Array<{ bucket?: string; path?: string; status: string }>,
      };
    },
    onSuccess: async (res) => {
      if (res.dryRun) {
        console.log("[storage-cleanup dry-run]", res);
        toast.info(
          `Dry-run: ${res.requested} caminho(s) seriam removidos. Nenhum dado alterado.`,
        );
        return;
      }
      await qc.invalidateQueries({ queryKey: ["storage-cleanup-jobs"] });
      if (res.failed === 0) {
        toast.success(`Limpeza concluída (${res.completed}).`);
      } else {
        toast.warning(`Limpeza parcial: ${res.completed} ok, ${res.failed} falharam.`);
      }
    },
    onError: (e: any) => toast.error(String(e?.message || "Falha ao reprocessar limpeza.")),
  });

  const rows = unified ?? [];
  const sstRawRows: SstCurrentRow[] = useMemo(
    () => rows.filter((r) => r.source === "sst" && r.sstRaw).map((r) => r.sstRaw as SstCurrentRow),
    [rows],
  );

  const currentByDocumentTypeId = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.documentTypeId) s.add(r.documentTypeId);
    }
    return s;
  }, [rows]);

  const openCreateQualification = () =>
    setDrawer({ mode: "create", current: null, presetDocumentTypeId: null, presetNrCode: null });

  const openManageInDocuments = (documentTypeId: string) =>
    navigate(`/workers/${workerId}?tab=documentos&document_type_id=${documentTypeId}`);

  const openAsoValidity = (q: UnifiedQualificationRow) => {
    setAsoValidity({
      documentId: q.id,
      documentTypeId: q.documentTypeId,
      code: q.code,
      issuedAt: q.issuedAt,
      expiresAt: q.expiresAt,
    });
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {loadingSummary ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <KpiCard testId="kpi-expired" label="Vencidas" value={summary?.expired ?? 0}
              tone={summary?.expired ? "text-destructive" : ""} />
            <KpiCard testId="kpi-expiring" label="Vencendo" value={summary?.expiringSoon ?? 0}
              tone={summary?.expiringSoon ? "text-amber-600 dark:text-amber-400" : ""} />
            <KpiCard testId="kpi-pending-docs" label="Pendentes de documento" value={summary?.pendingDocs ?? 0}
              tone={summary?.pendingDocs ? "text-blue-600 dark:text-blue-400" : ""} />
            <KpiCard testId="kpi-valid" label="Válidas" value={summary?.valid ?? 0}
              tone={summary?.valid ? "text-emerald-600 dark:text-emerald-400" : ""} />
            <KpiCard testId="kpi-active-links" label="Vínculos usando SST" value={summary?.activeLinksUsingSst ?? 0} tone="" />
          </>
        )}
      </div>

      {canDelete && pendingCount > 0 && (
        <div
          data-testid="storage-cleanup-alert"
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>
              <strong>{pendingCount}</strong> arquivo(s) aguardando limpeza no Storage.
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs" data-testid="storage-cleanup-phases">
            <span data-testid="phase-due">Elegíveis agora: <strong>{phaseCounts.due}</strong></span>
            <span data-testid="phase-waiting">Aguardando janela de retry: <strong>{phaseCounts.waiting}</strong></span>
            <span data-testid="phase-exhausted">Tentativas esgotadas: <strong>{phaseCounts.exhausted}</strong></span>
            {phaseCounts.completed > 0 && (
              <span data-testid="phase-completed">Concluídos: <strong>{phaseCounts.completed}</strong></span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={retryMut.isPending || phaseCounts.due === 0}
              onClick={() => retryMut.mutate({})}
              data-testid="storage-cleanup-retry"
              title={phaseCounts.due === 0 ? "Nenhum job elegível na janela atual" : "Processa jobs elegíveis"}
            >
              {retryMut.isPending ? "Reprocessando…" : "Reprocessar limpeza"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={retryMut.isPending}
              onClick={() => retryMut.mutate({ dryRun: true })}
              data-testid="storage-cleanup-dry-run"
            >
              Dry-run
            </Button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <Card>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <div>
            <p className="text-sm font-medium">Qualificações vigentes</p>
            <p className="text-xs text-muted-foreground">
              NRs, ASO e treinamentos ativos deste trabalhador.
            </p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              onClick={openCreateQualification}
              data-testid="add-qualification-button"
            >
              <Plus className="mr-1 h-3 w-3" /> Adicionar qualificação
            </Button>
          )}
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhuma qualificação registrada para este trabalhador.
              </p>
              {canEdit && (
                <Button size="sm" onClick={openCreateQualification}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar qualificação
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Qualificação</TableHead>
                  <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="hidden sm:table-cell">Vence em</TableHead>
                  <TableHead className="hidden md:table-cell">Arquivo</TableHead>
                  <TableHead className="text-right w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((q) => (
                  <QualRow
                    key={`${q.source}:${q.id}`}
                    q={q}
                    canEdit={canEdit}
                    onUpload={() => q.sstRaw && setDrawer({ mode: "replace", current: q.sstRaw as SstCurrentRow, presetDocumentTypeId: q.documentTypeId, presetNrCode: q.code })}
                    onRenew={() => q.sstRaw && setDrawer({ mode: "renew", current: q.sstRaw as SstCurrentRow, presetDocumentTypeId: q.documentTypeId, presetNrCode: q.code })}
                    onReplace={() => q.sstRaw && setDrawer({ mode: "replace", current: q.sstRaw as SstCurrentRow, presetDocumentTypeId: q.documentTypeId, presetNrCode: q.code })}
                    onHistory={() => setHistoryOpen({ nr: q.code, documentTypeId: q.documentTypeId })}
                    onLinks={() => setLinksOpen({ nr: q.code, docTypeId: q.documentTypeId })}
                    onTimeline={() => setTimelineOpen({ nr: q.code, docTypeId: q.documentTypeId })}
                    onManageInDocuments={() => openManageInDocuments(q.documentTypeId)}
                    onEditValidity={
                      q.category === "sst_aso" && q.storageFlow === "worker_documents" && canEdit
                        ? () => openAsoValidity(q)
                        : undefined
                    }
                    onDelete={
                      canDelete && q.source === "sst" && q.sstRaw
                        ? () =>
                            setDeleteTarget({
                              id: (q.sstRaw as SstCurrentRow).id,
                              code: q.code,
                              issuedAt: q.issuedAt,
                            })
                        : undefined
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {historyOpen && (
        <SstHistorySheet
          open={!!historyOpen}
          onOpenChange={(v) => !v && setHistoryOpen(null)}
          workerId={workerId}
          documentTypeId={historyOpen.documentTypeId}
          nrCode={historyOpen.nr}
        />
      )}
      {linksOpen && (
        <SstLinksUsingSheet
          open={!!linksOpen}
          onOpenChange={(v) => !v && setLinksOpen(null)}
          workerId={workerId}
          documentTypeId={linksOpen.docTypeId}
          nrCode={linksOpen.nr}
        />
      )}
      {timelineOpen && (
        <SstNrTimeline
          open={!!timelineOpen}
          onOpenChange={(v) => !v && setTimelineOpen(null)}
          workerId={workerId}
          documentTypeId={timelineOpen.docTypeId}
          nrCode={timelineOpen.nr}
          onOpenLinks={() =>
            setLinksOpen({ nr: timelineOpen.nr, docTypeId: timelineOpen.docTypeId })
          }
        />
      )}
      {drawer && (
        <SstCertificateDrawer
          open={!!drawer}
          onOpenChange={(v) => !v && setDrawer(null)}
          mode={drawer.mode}
          workerId={workerId}
          workerName={workerName}
          current={drawer.current}
          presetDocumentTypeId={drawer.presetDocumentTypeId}
          presetNrCode={drawer.presetNrCode}
          currentByDocumentTypeId={currentByDocumentTypeId}
          currentRows={sstRawRows}
          onRequestRenew={(row) => setDrawer({ mode: "renew", current: row, presetDocumentTypeId: row.document_type_id, presetNrCode: row.nr_code })}
          onRequestReplace={(row) => setDrawer({ mode: "replace", current: row, presetDocumentTypeId: row.document_type_id, presetNrCode: row.nr_code })}
          onManageInDocuments={(documentTypeId) => {
            setDrawer(null);
            openManageInDocuments(documentTypeId);
          }}
        />
      )}
      {asoValidity && (
        <AsoValidityDialog
          open={!!asoValidity}
          onOpenChange={(v) => !v && setAsoValidity(null)}
          workerId={workerId}
          documentId={asoValidity.documentId}
          documentTypeId={asoValidity.documentTypeId}
          documentCode={asoValidity.code}
          currentIssuedAt={asoValidity.issuedAt}
          currentExpiresAt={asoValidity.expiresAt}
          onManageInDocuments={() => {
            const dtId = asoValidity.documentTypeId;
            setAsoValidity(null);
            openManageInDocuments(dtId);
          }}
        />
      )}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Exclusão permanente"
        description={
          deleteTarget
            ? `Exclusão permanente. Esta NR (${deleteTarget.code}${
                deleteTarget.issuedAt
                  ? ` de ${new Date(deleteTarget.issuedAt + "T12:00:00").toLocaleDateString("pt-BR")}`
                  : ""
              }) e todo o histórico desta cadeia serão apagados e não poderão ser recuperados. Outras NRs, outros trabalhadores e o ASO não serão afetados.`
            : ""
        }
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        isDeleting={deleteMut.isPending}
      />
    </div>
  );
}

interface RowProps {
  q: UnifiedQualificationRow;
  canEdit: boolean;
  onUpload: () => void;
  onRenew: () => void;
  onReplace: () => void;
  onHistory: () => void;
  onLinks: () => void;
  onTimeline: () => void;
  onManageInDocuments: () => void;
  onEditValidity?: () => void;
  onDelete?: () => void;
}

function statusToBadge(s: UnifiedQualificationRow["status"]): SstOverallStatus {
  if (s === "expired") return "expired";
  if (s === "warning") return "expiring";
  if (s === "valid") return "valid";
  if (s === "rejected") return "pending";
  if (s === "missing_file") return "no_document";
  // pending / validity_unknown → tratamos como pendente
  return "pending";
}

function categoryLabel(c: UnifiedQualificationRow["category"]): string {
  if (c === "sst_nr") return "NR";
  if (c === "sst_aso") return "ASO";
  if (c === "training") return "Treinamento";
  return c;
}

function QualRow({ q, canEdit, onUpload, onRenew, onReplace, onHistory, onLinks, onTimeline, onManageInDocuments, onEditValidity, onDelete }: RowProps) {
  const status = statusToBadge(q.status);
  const days = daysUntil(q.expiresAt);
  const hasCert = !!q.documentUrl;
  const isDocFlow = q.storageFlow === "worker_documents";

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{q.code}</div>
        <div className="text-xs text-muted-foreground">{q.name}</div>
        {q.sourceConflict && (
          <div className="text-xs text-destructive font-medium">Conflito de fonte — verificar</div>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="text-xs text-muted-foreground">{categoryLabel(q.category)}</span>
      </TableCell>
      <TableCell><SstStatusBadge status={status} /></TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="text-sm">{fmtDate(q.expiresAt)}</div>
        {days != null && (q.status === "expired" || q.status === "warning") && (
          <div className={`text-xs ${q.status === "expired" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
            {days < 0 ? `há ${Math.abs(days)}d` : `em ${days}d`}
          </div>
        )}
        {q.validityStatus === "no_expiry" && (
          <div className="text-xs text-muted-foreground">sem validade</div>
        )}
        {q.status === "validity_unknown" && (
          <div className="text-xs text-muted-foreground">validade não informada</div>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {hasCert ? (
          <button
            type="button"
            onClick={() => openCertificate(q.documentUrl)}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" /> Ver
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {isDocFlow ? (
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {onEditValidity && (
              <Button
                size="sm"
                variant="default"
                onClick={onEditValidity}
                data-testid="edit-aso-validity"
              >
                Corrigir validade
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onManageInDocuments}
              data-testid="manage-in-documents"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              Documentos
            </Button>
          </div>
        ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && !hasCert && (
              <DropdownMenuItem onClick={onUpload}>
                <Upload className="mr-2 h-4 w-4" /> Anexar certificado
              </DropdownMenuItem>
            )}
            {canEdit && hasCert && (
              <>
                <DropdownMenuItem onClick={onRenew}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Renovar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onReplace}>
                  <Replace className="mr-2 h-4 w-4" /> Substituir
                </DropdownMenuItem>
              </>
            )}
            {canEdit && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={onHistory}>
              <History className="mr-2 h-4 w-4" /> Ver histórico
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTimeline}>
              <GitBranch className="mr-2 h-4 w-4" /> Ver linha do tempo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLinks}>
              <Users className="mr-2 h-4 w-4" /> Ver vínculos
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                  data-testid="delete-qualification"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir certificado
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}