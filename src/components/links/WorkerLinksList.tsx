import { useNavigate } from "react-router-dom";
import { useEmploymentLinksByWorker } from "@/hooks/useEmploymentLinks";
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
  const { data: links, isLoading } = useEmploymentLinksByWorker(workerId);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Vínculos</CardTitle>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/links/new?worker=${workerId}`)}>
            <Plus className="mr-1 h-3 w-3" /> Novo vínculo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !links?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum vínculo cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {(links as any[]).map((link) => {
              const eventName = (link.events as any)?.name || "Sem evento";
              const displayName = link.link_name || `${link.job_role || "—"} — ${eventName}`;
              return (
                <div
                  key={link.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
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
      </CardContent>
    </Card>
  );
}
