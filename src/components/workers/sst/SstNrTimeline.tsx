import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSstQualificationHistory, type SstHistoryRow } from "@/hooks/useWorkerSst";
import {
  ExternalLink, FileText, Users,
  Plus, RefreshCw, Replace, PenLine, Ban, Clock, Package, CircleDot,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openCertificate } from "@/lib/sst/certificate-url";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workerId: string;
  nrCode: string;
  onOpenLinks?: () => void;
}

type EventKind =
  | "created" | "renewed" | "corrected" | "replaced"
  | "revoked" | "expired" | "migrated" | "other";

const EVENT_META: Record<EventKind, { label: string; icon: LucideIcon; tone: string }> = {
  created:   { label: "Criada",     icon: Plus,      tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  renewed:   { label: "Renovada",   icon: RefreshCw, tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  corrected: { label: "Corrigida",  icon: PenLine,   tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  replaced:  { label: "Substituída", icon: Replace,  tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  revoked:   { label: "Revogada",   icon: Ban,       tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  expired:   { label: "Expirada",   icon: Clock,     tone: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  migrated:  { label: "Migrada",    icon: Package,   tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  other:     { label: "Revisão",    icon: CircleDot, tone: "bg-muted text-muted-foreground" },
};

function classifyEvent(r: SstHistoryRow): EventKind {
  if (r.document_status === "revoked") return "revoked";
  if (r.revision_reason === "migrated" || r.source_type === "migration") return "migrated";
  if (r.revision_reason === "correction") return "corrected";
  if (r.revision_type === "renewal") return "renewed";
  if (r.revision_type === "replacement") return "replaced";
  if (r.revision_type === "initial") return "created";
  if (r.validity_status === "expired") return "expired";
  return "other";
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso.length > 10 ? iso : iso + "T12:00:00").toLocaleDateString("pt-BR");
}

export function SstNrTimeline({ open, onOpenChange, workerId, nrCode, onOpenLinks }: Props) {
  const { data, isLoading } = useSstQualificationHistory(workerId, nrCode, { enabled: open });
  const rows = data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Linha do tempo — {nrCode}</SheetTitle>
          <SheetDescription>
            Como esta qualificação evoluiu ao longo do tempo. Ordem: mais recente → mais antiga.
          </SheetDescription>
        </SheetHeader>

        {onOpenLinks && (
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={onOpenLinks} className="w-full sm:w-auto">
              <Users className="mr-2 h-4 w-4" /> Ver vínculos utilizando esta NR
            </Button>
          </div>
        )}

        <div className="mt-6 space-y-5">
          {isLoading && (<><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></>)}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sem histórico registrado para esta NR.
            </p>
          )}
          {!isLoading && rows.map((r, idx) => {
            const kind = classifyEvent(r);
            const meta = EVENT_META[kind];
            const Icon = meta.icon;
            const isLast = idx === rows.length - 1;
            return (
              <div key={r.id} className="relative pl-10">
                <div className={`absolute left-0 top-0 h-8 w-8 rounded-full flex items-center justify-center ${meta.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                {!isLast && (
                  <div className="absolute left-4 top-8 bottom-[-1.25rem] w-px bg-border" />
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{meta.label}</span>
                    {r.is_current && <Badge variant="secondary" className="text-xs">Vigente</Badge>}
                    {r.superseded_at && !r.is_current && (
                      <Badge variant="outline" className="text-xs">
                        Substituída em {fmtDate(r.superseded_at)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Emitida em {fmtDate(r.issued_at)}
                    {r.expires_at && ` • Vence em ${fmtDate(r.expires_at)}`}
                    {r.workload_hours != null && ` • ${r.workload_hours}h`}
                  </p>
                  {(r.provider_name || r.instructor_name) && (
                    <p className="text-xs text-muted-foreground">
                      {[r.provider_name, r.instructor_name].filter(Boolean).join(" • ")}
                    </p>
                  )}
                  {r.notes && <p className="text-xs italic text-muted-foreground">"{r.notes}"</p>}
                  {r.document_url && (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2 text-xs"
                      onClick={() => openCertificate(r.document_url)}
                    >
                      <FileText className="mr-1 h-3 w-3" /> Baixar certificado desta revisão
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}