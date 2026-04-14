import { useNavigate } from "react-router-dom";
import { useLinkGroupsByEvent } from "@/hooks/useLinkGroups";
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

interface Props { eventId: string; }

export function EventLinksList({ eventId }: Props) {
  const { data: groups, isLoading } = useLinkGroupsByEvent(eventId);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Grupos de vínculo</CardTitle>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/links/new?event=${eventId}`)}>
            <Plus className="mr-1 h-3 w-3" /> Novo grupo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !groups?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum grupo de vínculo cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group: any) => (
              <div
                key={group.id}
                className="flex items-center justify-between gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/links/${group.id}`)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{group.group_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.worker_count} trabalhador{group.worker_count !== 1 ? "es" : ""}
                  </p>
                </div>
                <Badge variant={statusVariant(group.status)} className="text-xs shrink-0">
                  {statusLabels[group.status] || group.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
