import { useParams, useNavigate } from "react-router-dom";
import { useEmploymentLink } from "@/hooks/useEmploymentLinks";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { OperationalDocsChecklist } from "@/components/events/OperationalDocsChecklist";

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  suspended: "Suspenso",
  completed: "Concluído",
  terminated: "Encerrado",
  cancelled: "Cancelado",
};

const statusVariant = (s: string) => {
  if (s === "active") return "default" as const;
  if (s === "completed" || s === "terminated") return "secondary" as const;
  if (s === "cancelled") return "destructive" as const;
  return "outline" as const;
};

const contractLabels: Record<string, string> = {
  clt: "CLT", pj: "PJ", freelancer: "Freelancer", temporary: "Temporário", intern: "Estagiário",
};

const remunerationLabels: Record<string, string> = {
  daily: "Diarista", monthly: "Mensalista", hourly: "Horista", per_event: "Por evento",
};

const paymentLabels: Record<string, string> = {
  daily: "Diária", weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal", per_event: "Por evento",
};

const formatDateBR = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export default function LinkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: link, isLoading } = useEmploymentLink(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!link) {
    return <p className="py-8 text-center text-muted-foreground">Vínculo não encontrado.</p>;
  }

  const l = link as any;
  const workerName = l.workers?.full_name || "—";
  const workerNick = l.workers?.nickname;
  const eventName = l.events?.name || "—";
  const displayName = l.link_name || `${workerName} — ${eventName}`;

  const info = (label: string, value: string | number | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value != null && value !== "" ? String(value) : "—"}</p>
    </div>
  );

  const currency = (label: string, value: number | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono">{value != null ? `R$ ${Number(value).toFixed(2)}` : "—"}</p>
    </div>
  );

  const event = l.events;

  const workDaysDisplay = () => {
    if (l.work_days_mode === "specific_dates" && l.specific_work_dates?.length > 0) {
      return l.specific_work_dates.map((d: string) => formatDateBR(d)).join(", ");
    }
    return "Contínuo";
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/links")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground">{displayName}</h1>
              <Badge variant={statusVariant(l.status)}>{statusLabels[l.status] || l.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {workerName}{workerNick ? ` (${workerNick})` : ""} · {eventName}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/links/${id}/edit`)}>
            <Pencil className="mr-1 h-3 w-3" /> Editar
          </Button>
        )}
      </div>

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Trabalhador", `${workerName}${workerNick ? ` (${workerNick})` : ""}`)}
              {info("Evento", eventName)}
              {info("Função/Cargo", l.job_role)}
              {info("Atividade", l.job_function)}
              {info("Departamento", l.department)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contrato</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Tipo de contrato", l.contract_type ? contractLabels[l.contract_type] || l.contract_type : null)}
              {info("Status", statusLabels[l.status] || l.status)}
              {info("Data início", formatDateBR(l.hire_date))}
              {info("Data fim", formatDateBR(l.end_date))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Jornada</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("Turno", l.shift_type)}
              {info("Escala", l.work_shift)}
              {info("Horário", l.work_schedule)}
              {info("Horário de chamada", l.call_time)}
              {info("Horas diárias", l.daily_hours)}
              {info("Horas semanais", l.weekly_hours)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Dias de atuação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-1">
              {info("Modo", l.work_days_mode === "specific_dates" ? "Datas específicas" : "Contínuo")}
              {l.work_days_mode === "specific_dates" && l.specific_work_dates?.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Datas de atuação</p>
                  <div className="flex flex-wrap gap-1">
                    {l.specific_work_dates.map((d: string) => (
                      <Badge key={d} variant="secondary">{formatDateBR(d)}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {info("Observações da escala", l.work_days_notes)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Operacional</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Supervisor", l.supervisor_name)}
              {info("Ponto de encontro", l.assembly_point)}
              {info("Uniforme", l.uniform_notes)}
              {info("Transporte", l.transport_notes)}
              {info("Refeição", l.meal_entitlement)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Remuneração e benefícios</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("Tipo de remuneração", l.remuneration_type ? remunerationLabels[l.remuneration_type] || l.remuneration_type : null)}
              {currency("Diária", l.daily_rate)}
              {currency("Hora", l.hourly_rate)}
              {currency("Salário fixo", l.fixed_salary)}
              {info("Frequência pagamento", l.payment_frequency ? paymentLabels[l.payment_frequency] || l.payment_frequency : null)}
              {info("Vale-transporte", l.has_transport_allowance ? "Sim" : "Não")}
              {l.has_transport_allowance && currency("Valor VT", l.transport_allowance)}
              {info("Vale-refeição/alimentação", l.has_meal_allowance ? "Sim" : "Não")}
              {l.has_meal_allowance && currency("Valor VR/VA", l.meal_allowance)}
            </CardContent>
          </Card>

          {l.notes && (
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-wrap">{l.notes}</p></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          {event ? (
            <OperationalDocsChecklist employmentLinkId={l.id} workerId={l.worker_id} event={event} />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum evento vinculado — documentos operacionais não aplicáveis.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
