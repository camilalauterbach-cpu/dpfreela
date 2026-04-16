import { useNavigate } from "react-router-dom";
import { useEmploymentLinksByWorker } from "@/hooks/useEmploymentLinks";
import { useWorkerGroupAllocations } from "@/hooks/useLinkGroups";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "Rascunho", active: "Ativo", suspended: "Suspenso",
  completed: "Concluído", terminated: "Encerrado", cancelled: "Cancelado",
};

const statusVariant = (s: string) => {
  if (s === "active") return "default" as const;
  if (s === "completed" || s === "terminated") return "secondary" as const;
  if (s === "cancelled") return "destructive" as const;
  return "outline" as const;
};

interface Props { workerId: string; }

export function WorkerLinksList({ workerId }: Props) {
  const { data: links, isLoading: loadingLinks } = useEmploymentLinksByWorker(workerId);
  const { data: allocations, isLoading: loadingAllocations } = useWorkerGroupAllocations(workerId);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  const isLoading = loadingLinks || loadingAllocations;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Vínculos</CardTitle>
          <p className="text-xs text-muted-foreground">
            A exclusão do trabalhador só é liberada quando não houver alocações ativas em grupos.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/links/new?worker=${workerId}`)}>
            <Plus className="mr-1 h-3 w-3" /> Novo vínculo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vínculos de trabalho</p>
              {!links?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum vínculo cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {(links as any[]).map((link) => {
                    const eventName = (link.events as any)?.name || "Sem evento";
                    const displayName = link.link_name || `${link.job_role || "—"} — ${eventName}`;
                    return (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/links/${link.id}`)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{displayName}</p>
                          <p className="text-xs text-muted-foreground">
                            {eventName}
                            {link.hire_date && ` · ${new Date(link.hire_date + "T12:00:00").toLocaleDateString("pt-BR")}`}
                          </p>
                        </div>
                        <Badge variant={statusVariant(link.status)} className="shrink-0">
                          {statusLabels[link.status] || link.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Alocações em grupos</p>
              {!allocations?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma alocação ativa em grupo.</p>
              ) : (
                <div className="space-y-2">
                  {(allocations as any[]).map((allocation) => {
                    const group = allocation.link_groups as any;
                    const groupName = group?.group_name || "Sem grupo";
                    const eventName = group?.events?.name || "Sem evento";

                    return (
                      <div
                        key={allocation.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/links/${allocation.link_group_id}/workers/${workerId}`)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{groupName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {allocation.job_role || "Sem função definida"} · {eventName}
                            {allocation.hire_date && ` · ${new Date(allocation.hire_date + "T12:00:00").toLocaleDateString("pt-BR")}`}
                          </p>
                        </div>
                        <Badge variant={statusVariant(allocation.status)} className="shrink-0">
                          {statusLabels[allocation.status] || allocation.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
