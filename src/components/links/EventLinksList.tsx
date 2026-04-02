import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmploymentLinksByEvent } from "@/hooks/useEmploymentLinks";
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
  const { data: links, isLoading } = useEmploymentLinksByEvent(eventId);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  // Get doc counts per link
  const linkIds = (links as any[])?.map((l) => l.id) || [];
  const { data: allDocs } = useQuery({
    queryKey: ["link-docs-summary", eventId, linkIds],
    enabled: linkIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_link_documents")
        .select("employment_link_id, status, category")
        .in("employment_link_id", linkIds)
        .eq("document_type", "operacional_evento")
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  // Get event requirements to count total required docs
  const { data: event } = useQuery({
    queryKey: ["event-reqs", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("requires_epi_form, requires_service_order, required_nrs, required_nrs_other")
        .eq("id", eventId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const totalRequired = (() => {
    if (!event) return 0;
    const ev = event as any;
    let c = 0;
    if (ev.requires_epi_form) c++;
    if (ev.requires_service_order) c++;
    if (ev.required_nrs) c += ev.required_nrs.length;
    if (ev.required_nrs_other) c++;
    return c;
  })();

  const getApproved = (linkId: string) => {
    if (!allDocs) return 0;
    return (allDocs as any[]).filter((d) => d.employment_link_id === linkId && d.status === "approved").length;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Trabalhadores vinculados</CardTitle>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/links/new?event=${eventId}`)}>
            <Plus className="mr-1 h-3 w-3" /> Vincular trabalhador
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !links?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum trabalhador vinculado.</p>
        ) : (
          <div className="space-y-2">
            {(links as any[]).map((link) => {
              const workerName = (link.workers as any)?.full_name || "—";
              const workerNick = (link.workers as any)?.nickname;
              const displayName = link.link_name || `${workerName}${workerNick ? ` (${workerNick})` : ""}`;
              const approved = getApproved(link.id);
              const isComplete = totalRequired > 0 && approved === totalRequired;

              return (
                <div
                  key={link.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/links/${link.id}`)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {link.job_role || "Sem função"}
                      {totalRequired > 0 && ` · Docs: ${approved}/${totalRequired}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {totalRequired > 0 && (
                      <Badge variant={isComplete ? "default" : "secondary"} className="text-xs">
                        {isComplete ? "Completo" : "Incompleto"}
                      </Badge>
                    )}
                    <Badge variant={statusVariant(link.status)} className="text-xs">
                      {statusLabels[link.status] || link.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
