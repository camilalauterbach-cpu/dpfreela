import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  FileText, ExternalLink, ShieldCheck, FolderOpen, Trash2,
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
import { openCertificate } from "@/lib/sst/certificate-url";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { invalidateSstCaches } from "@/hooks/useSstQualifications";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</p>
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

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("delete_sst_revision", {
        p_qualification_id: id,
      });
      if (error) throw error;
      // Reavalia vínculos após exclusão para recalcular indicadores.
      await (supabase as any).rpc("reevaluate_worker_links", {
        p_worker_id: workerId,
        p_event_source: "delete_sst_revision",
      });
    },
    onSuccess: () => {
      invalidateSstCaches(qc);
      invalidateComplianceCaches(qc, { workerId, eventSource: "admin_update" });
      qc.invalidateQueries({ queryKey: ["worker-sst-current", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-summary", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-history", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] });
      toast.success("Certificado excluído.");
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast.error(String(e?.message || "Falha ao excluir certificado."));
    },
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

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {loadingSummary ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <KpiCard label="Vencidas" value={summary?.expired ?? 0}
              tone={summary?.expired ? "text-destructive" : ""} />
            <KpiCard label="Vencendo" value={summary?.expiringSoon ?? 0}
              tone={summary?.expiringSoon ? "text-amber-600 dark:text-amber-400" : ""} />
            <KpiCard label="Pendentes de documento" value={summary?.pendingDocs ?? 0}
              tone={summary?.pendingDocs ? "text-blue-600 dark:text-blue-400" : ""} />
            <KpiCard label="Válidas" value={summary?.valid ?? 0}
              tone={summary?.valid ? "text-emerald-600 dark:text-emerald-400" : ""} />
            <KpiCard label="Vínculos usando SST" value={summary?.activeLinksUsingSst ?? 0} tone="" />
          </>
        )}
      </div>

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
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Excluir certificado"
        description={
          deleteTarget
            ? `Excluir o certificado ${deleteTarget.code}${
                deleteTarget.issuedAt
                  ? ` de ${new Date(deleteTarget.issuedAt + "T12:00:00").toLocaleDateString("pt-BR")}`
                  : ""
              }? Apenas este registro será removido. Outros certificados e o trabalhador não serão afetados. Os indicadores serão recalculados.`
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

function QualRow({ q, canEdit, onUpload, onRenew, onReplace, onHistory, onLinks, onTimeline, onManageInDocuments, onDelete }: RowProps) {
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
          <Button
            size="sm"
            variant="outline"
            onClick={onManageInDocuments}
            data-testid="manage-in-documents"
          >
            <FolderOpen className="mr-1 h-3 w-3" />
            Gerenciar na aba Documentos
          </Button>
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