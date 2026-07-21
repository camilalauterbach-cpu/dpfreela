import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSstQualificationHistory } from "@/hooks/useWorkerSst";
import { ExternalLink, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workerId: string;
  nrCode: string;
}

const REVISION_LABEL: Record<string, string> = {
  initial: "Criada",
  renewal: "Renovada",
  replacement: "Substituída",
  additional: "Adicional",
};

const REASON_LABEL: Record<string, string> = {
  new_qualification: "Novo registro",
  renewal: "Renovação",
  correction: "Correção",
  replacement: "Substituição",
  migrated: "Migrada de documentos",
  admin_update: "Atualização administrativa",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso.length > 10 ? iso : iso + "T12:00:00").toLocaleDateString("pt-BR");
}

export function SstHistorySheet({ open, onOpenChange, workerId, nrCode }: Props) {
  const { data, isLoading } = useSstQualificationHistory(workerId, nrCode, { enabled: open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Histórico de {nrCode}</SheetTitle>
          <SheetDescription>Todas as revisões desta NR, da mais recente à mais antiga.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {isLoading && (<><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></>)}
          {!isLoading && (data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem histórico registrado.</p>
          )}
          {!isLoading && (data ?? []).map((r, idx) => (
            <div key={r.id} className="relative pl-6">
              <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              {idx < (data!.length - 1) && (
                <div className="absolute left-[5px] top-4 bottom-[-1rem] w-px bg-border" />
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {REVISION_LABEL[r.revision_type] ?? r.revision_type}
                  </span>
                  {r.is_current && <Badge variant="secondary" className="text-xs">Vigente</Badge>}
                  {r.revision_reason && (
                    <Badge variant="outline" className="text-xs">
                      {REASON_LABEL[r.revision_reason] ?? r.revision_reason}
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
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    <a href={r.document_url} target="_blank" rel="noreferrer">
                      <FileText className="mr-1 h-3 w-3" /> Ver certificado
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}