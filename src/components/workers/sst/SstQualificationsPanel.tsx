import { useMemo, useState } from "react";
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
  FileText, ExternalLink, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useWorkerSstQualifications, useWorkerSstSummary,
} from "@/hooks/useWorkerSst";
import type { SstCurrentRow } from "@/hooks/useSstQualifications";
import {
  SstStatusBadge, resolveOverall, OVERALL_PRIORITY, daysUntil,
} from "./SstStatusBadge";
import { SstHistorySheet } from "./SstHistorySheet";
import { SstLinksUsingSheet } from "./SstLinksUsingSheet";
import { SstNrTimeline } from "./SstNrTimeline";
import { SstCertificateDrawer, type SstDrawerMode } from "./SstCertificateDrawer";
import { openCertificate } from "@/lib/sst/certificate-url";

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
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const { data: quals, isLoading } = useWorkerSstQualifications(workerId);
  const { data: summary, isLoading: loadingSummary } = useWorkerSstSummary(workerId);

  const [historyOpen, setHistoryOpen] = useState<{ nr: string } | null>(null);
  const [linksOpen, setLinksOpen] = useState<{ nr: string; docTypeId: string | null } | null>(null);
  const [timelineOpen, setTimelineOpen] = useState<{ nr: string; docTypeId: string | null } | null>(null);
  const [drawer, setDrawer] = useState<
    {
      mode: SstDrawerMode;
      current: SstCurrentRow | null;
      presetDocumentTypeId: string | null;
      presetNrCode: string | null;
    } | null
  >(null);

  const rows = useMemo(() => {
    if (!quals) return [];
    return [...quals].sort((a, b) => {
      const pa = OVERALL_PRIORITY[resolveOverall(a)];
      const pb = OVERALL_PRIORITY[resolveOverall(b)];
      if (pa !== pb) return pa - pb;
      // dentro da mesma prioridade, mais próximo do vencimento primeiro
      const da = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
      const db = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
      if (da !== db) return da - db;
      return a.nr_code.localeCompare(b.nr_code, "pt-BR");
    });
  }, [quals]);

  const currentByDocumentTypeId = useMemo(() => {
    const s = new Set<string>();
    for (const q of quals ?? []) {
      if (q.document_type_id) s.add(q.document_type_id);
    }
    return s;
  }, [quals]);

  const openCreateQualification = () =>
    setDrawer({ mode: "create", current: null, presetDocumentTypeId: null, presetNrCode: null });

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
                  <TableHead>NR</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="hidden sm:table-cell">Vence em</TableHead>
                  <TableHead className="hidden md:table-cell">Certificado</TableHead>
                  <TableHead className="text-right w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((q) => (
                  <QualRow
                    key={q.id}
                    q={q}
                    canEdit={canEdit}
                    onUpload={() => setDrawer({ mode: "replace", current: q, presetDocumentTypeId: q.document_type_id, presetNrCode: q.nr_code })}
                    onRenew={() => setDrawer({ mode: "renew", current: q, presetDocumentTypeId: q.document_type_id, presetNrCode: q.nr_code })}
                    onReplace={() => setDrawer({ mode: "replace", current: q, presetDocumentTypeId: q.document_type_id, presetNrCode: q.nr_code })}
                    onHistory={() => setHistoryOpen({ nr: q.nr_code })}
                    onLinks={() => setLinksOpen({ nr: q.nr_code, docTypeId: q.document_type_id })}
                    onTimeline={() => setTimelineOpen({ nr: q.nr_code, docTypeId: q.document_type_id })}
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
          currentRows={rows}
          onRequestRenew={(row) => setDrawer({ mode: "renew", current: row, presetDocumentTypeId: row.document_type_id, presetNrCode: row.nr_code })}
          onRequestReplace={(row) => setDrawer({ mode: "replace", current: row, presetDocumentTypeId: row.document_type_id, presetNrCode: row.nr_code })}
        />
      )}
    </div>
  );
}

interface RowProps {
  q: SstCurrentRow;
  canEdit: boolean;
  onUpload: () => void;
  onRenew: () => void;
  onReplace: () => void;
  onHistory: () => void;
  onLinks: () => void;
  onTimeline: () => void;
}

function QualRow({ q, canEdit, onUpload, onRenew, onReplace, onHistory, onLinks, onTimeline }: RowProps) {
  const status = resolveOverall(q);
  const days = daysUntil(q.expires_at);
  const hasCert = !!q.document_url;

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{q.nr_code}</div>
        {q.training_type && (
          <div className="text-xs text-muted-foreground">{q.training_type}</div>
        )}
      </TableCell>
      <TableCell><SstStatusBadge status={status} /></TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="text-sm">{fmtDate(q.expires_at)}</div>
        {days != null && (status === "expired" || status === "expiring") && (
          <div className={`text-xs ${status === "expired" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
            {days < 0 ? `há ${Math.abs(days)}d` : `em ${days}d`}
          </div>
        )}
        {q.validity_status === "no_expiry" && (
          <div className="text-xs text-muted-foreground">sem validade</div>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {hasCert ? (
          <button
            type="button"
            onClick={() => openCertificate(q.document_url)}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}