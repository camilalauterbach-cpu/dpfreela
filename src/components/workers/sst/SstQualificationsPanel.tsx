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
  Upload, RefreshCw, Replace, History, Users, MoreHorizontal,
  FileText, ExternalLink, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
}

export function SstQualificationsPanel({ workerId }: Props) {
  const { toast } = useToast();
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const { data: quals, isLoading } = useWorkerSstQualifications(workerId);
  const { data: summary, isLoading: loadingSummary } = useWorkerSstSummary(workerId);

  const [historyOpen, setHistoryOpen] = useState<{ nr: string } | null>(null);
  const [linksOpen, setLinksOpen] = useState<{ nr: string; docTypeId: string | null } | null>(null);

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

  // Placeholder até a E-SST.2.C (drawer de envio de certificado).
  const notYet = (label: string) =>
    toast({
      title: label,
      description: "Disponível na E-SST.2.C — Drawer de envio de certificado.",
    });

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
                Nenhuma NR registrada para este trabalhador.
              </p>
              {canEdit && (
                <Button size="sm" onClick={() => notYet("Anexar certificado")}>
                  <Upload className="mr-1 h-3 w-3" /> Anexar primeiro certificado
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
                    onUpload={() => notYet("Anexar certificado")}
                    onRenew={() => notYet("Renovar NR")}
                    onReplace={() => notYet("Substituir NR")}
                    onHistory={() => setHistoryOpen({ nr: q.nr_code })}
                    onLinks={() => setLinksOpen({ nr: q.nr_code, docTypeId: q.document_type_id })}
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
}

function QualRow({ q, canEdit, onUpload, onRenew, onReplace, onHistory, onLinks }: RowProps) {
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
          <a
            href={q.document_url!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" /> Ver
            <ExternalLink className="h-3 w-3" />
          </a>
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
            <DropdownMenuItem onClick={onLinks}>
              <Users className="mr-2 h-4 w-4" /> Ver vínculos
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}