import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useEvent } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Loader2, Trash2 } from "lucide-react";
import { EventLinksList } from "@/components/links/EventLinksList";
import { EventDocumentsTab } from "@/components/events/EventDocumentsTab";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useDeleteRecord } from "@/hooks/useDeleteRecord";

const statusLabels: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const statusVariant = (s: string) => {
  if (s === "active") return "default" as const;
  if (s === "confirmed") return "default" as const;
  if (s === "completed") return "secondary" as const;
  if (s === "cancelled") return "destructive" as const;
  return "outline" as const;
};

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading } = useEvent(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager"]);
  const { deleteRecord, isDeleting } = useDeleteRecord("events", ["events", "event", "dashboard-counts"]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!event) {
    return <p className="py-8 text-center text-muted-foreground">Evento não encontrado.</p>;
  }

  const info = (label: string, value: string | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );

  const companyName = (event.companies as any)?.legal_name;
  const companyTrade = (event.companies as any)?.trade_name;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => navigate("/events")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-semibold text-foreground break-words">{event.name}</h1>
              <Badge variant={statusVariant(event.status)}>{statusLabels[event.status] || event.status}</Badge>
            </div>
            {companyName && <p className="text-xs sm:text-sm text-muted-foreground truncate">{companyName}</p>}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={() => navigate(`/events/${id}/edit`)}>
              <Pencil className="mr-1 h-3 w-3" /> <span className="hidden sm:inline">Editar</span>
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Excluir evento"
        description={`Tem certeza que deseja excluir "${event.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => deleteRecord(event.id, { onSuccess: () => navigate("/events") })}
        isDeleting={isDeleting}
      />

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="dados" className="text-xs sm:text-sm">Informações</TabsTrigger>
          <TabsTrigger value="documentos" className="text-xs sm:text-sm">Documentos</TabsTrigger>
          <TabsTrigger value="vinculos" className="text-xs sm:text-sm">Vínculos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Dados do evento</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {info("Nome", event.name)}
              {info("Empresa", companyName ? `${companyName}${companyTrade ? ` (${companyTrade})` : ""}` : null)}
              {info("Descrição", event.description)}
              {info("Status", statusLabels[event.status] || event.status)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Período e local</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {info("Data início", event.start_date ? new Date(event.start_date + "T12:00:00").toLocaleDateString("pt-BR") : null)}
              {info("Data fim", event.end_date ? new Date(event.end_date + "T12:00:00").toLocaleDateString("pt-BR") : null)}
              {info("Local", event.location)}
              {info("Cidade/UF", [event.city, event.state].filter(Boolean).join("/") || null)}
            </CardContent>
          </Card>

          {/* Exigências para trabalhadores alocados */}
          {(() => {
            const ev = event as any;
            const hasRequirements = ev.requires_epi_form || ev.requires_service_order || (ev.required_nrs && ev.required_nrs.length > 0) || ev.required_nrs_other;
            if (!hasRequirements) return null;
            return (
              <Card>
                <CardHeader><CardTitle className="text-base">Exigências para trabalhadores alocados</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {ev.requires_epi_form && <p className="text-sm">✅ Exige ficha de entrega de EPI</p>}
                  {ev.requires_service_order && <p className="text-sm">✅ Exige ordem de serviço</p>}
                  {ev.required_nrs && ev.required_nrs.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">NRs exigidas</p>
                      <div className="flex flex-wrap gap-1">
                        {ev.required_nrs.map((nr: string) => (
                          <Badge key={nr} variant="secondary">{nr}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {ev.required_nrs_other && (
                    <div>
                      <p className="text-xs text-muted-foreground">Outras exigências</p>
                      <p className="text-sm">{ev.required_nrs_other}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {event.notes && (
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{event.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <EventDocumentsTab eventId={event.id} />
        </TabsContent>

        <TabsContent value="vinculos" className="mt-4">
          <EventLinksList eventId={event.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
