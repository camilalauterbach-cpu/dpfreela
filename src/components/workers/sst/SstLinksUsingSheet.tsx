import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSstLinksUsingNr } from "@/hooks/useWorkerSst";
import { Briefcase, Calendar, Users } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workerId: string;
  documentTypeId: string | null;
  nrCode: string;
}

export function SstLinksUsingSheet({ open, onOpenChange, workerId, documentTypeId, nrCode }: Props) {
  const { data, isLoading } = useSstLinksUsingNr(workerId, documentTypeId ?? undefined, { enabled: open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Vínculos usando {nrCode}</SheetTitle>
          <SheetDescription>
            Vínculos ativos deste trabalhador que exigem esta NR e o motivo da exigência.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {isLoading && (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          )}
          {!isLoading && (data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum vínculo ativo exige esta NR no momento.
            </p>
          )}
          {!isLoading && (data ?? []).map((l) => (
            <div key={l.link_id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {l.event_name || "—"}
                  </div>
                  {l.link_group_name && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <Users className="h-3 w-3 shrink-0" />
                      {l.link_group_name}
                    </div>
                  )}
                  {l.job_role_name && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      {l.job_role_name}
                    </div>
                  )}
                </div>
                {l.status && (
                  <Badge variant="outline" className="text-xs shrink-0">{l.status}</Badge>
                )}
              </div>
              <div className="pt-1 border-t">
                <p className="text-xs text-muted-foreground mb-1">Exigido por:</p>
                <div className="flex flex-wrap gap-1.5">
                  {l.required_by === "job_role" && (
                    <Badge variant="secondary" className="text-xs">✓ Cargo</Badge>
                  )}
                  {l.required_by === "link_override" && l.override_action === "add" && (
                    <Badge variant="secondary" className="text-xs">✓ Exceção do vínculo</Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}