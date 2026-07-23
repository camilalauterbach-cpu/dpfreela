import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useLinkGroup, useLinkGroupWorker } from "@/hooks/useLinkGroups";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Pencil, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LinkDocumentsTab } from "@/components/links/LinkDocumentsTab";
import { AllocationEditForm } from "@/components/links/AllocationEditForm";
import { LinkComplianceCard } from "@/components/compliance/LinkComplianceCard";
import { ComplianceTimeline } from "@/components/compliance/ComplianceTimeline";

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

const contractTypeLabels: Record<string, string> = {
  clt: "CLT", service: "Prestação de serviço",
};

const remunerationTypeLabels: Record<string, string> = {
  cache: "Cachê", daily: "Diária", hourly: "Hora", fixed: "Salário fixo",
};

const formatDateBR = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const formatCurrency = (v: number | null | undefined) => {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
};

function getEffectiveValue(w: any) {
  if (w.remuneration_type === "hourly") return w.hourly_rate;
  if (w.remuneration_type === "fixed") return w.fixed_salary;
  return w.daily_rate;
}

function getEffectiveLabel(type: string) {
  switch (type) {
    case "cache": return "Valor do cachê";
    case "daily": return "Valor da diária";
    case "hourly": return "Valor da hora";
    case "fixed": return "Valor do salário fixo";
    default: return "Valor efetivo";
  }
}

export default function LinkWorkerDetail() {
  const { groupId, workerId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const { data: group, isLoading: loadingGroup } = useLinkGroup(groupId);
  const { data: allocation, isLoading: loadingAlloc } = useLinkGroupWorker(groupId, workerId);
  const [editing, setEditing] = useState(false);

  if (loadingGroup || loadingAlloc) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!group || !allocation) {
    return <p className="py-8 text-center text-muted-foreground">Alocação não encontrada.</p>;
  }

  const g = group as any;
  const a = allocation as any;
  const employmentLinkId: string | null = a.employment_link_id ?? null;
  const worker = a.workers;
  const eventName = g.events?.name || "—";

  const info = (label: string, value: string | number | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value != null && value !== "" ? String(value) : "—"}</p>
    </div>
  );

  const handleSaved = () => {
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["link-group-worker", groupId, workerId] });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => navigate(`/links/${groupId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground break-words">{worker?.full_name || "Trabalhador"}</h1>
            <Badge variant={statusVariant(a.status)}>{statusLabels[a.status] || a.status}</Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {g.group_name} · {eventName}
          </p>
        </div>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-3 w-3" /> <span className="hidden sm:inline">Editar alocação</span><span className="sm:hidden">Editar</span>
          </Button>
        )}
      </div>

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="dados" className="text-xs sm:text-sm">Dados da alocação</TabsTrigger>
          <TabsTrigger value="conformidade" className="text-xs sm:text-sm">Conformidade</TabsTrigger>
          <TabsTrigger value="documentos" className="text-xs sm:text-sm">Documentos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          {editing ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Editar alocação</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
                </div>
              </CardHeader>
              <CardContent>
                <AllocationEditForm allocation={a} groupId={groupId!} onSaved={handleSaved} />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Identificação */}
              <Card>
                <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {info("Nome completo", worker?.full_name)}
                  {info("Apelido", worker?.nickname)}
                  {info("CPF", worker?.cpf)}
                  {info("Telefone", worker?.phone_main)}
                </CardContent>
              </Card>

              {/* Contrato */}
              <Card>
                <CardHeader><CardTitle className="text-base">Contrato</CardTitle></CardHeader>
                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {info("Tipo de contrato", contractTypeLabels[a.contract_type] || a.contract_type)}
                  {info("Função/Cargo", a.job_roles?.name || a.job_role)}
                  {info("Atividade", a.job_function)}
                  {info("Departamento", a.department)}
                  {info("Data início", formatDateBR(a.hire_date))}
                  {info("Data fim", formatDateBR(a.end_date))}
                </CardContent>
              </Card>

              {/* Jornada */}
              <Card>
                <CardHeader><CardTitle className="text-base">Jornada</CardTitle></CardHeader>
                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {info("Turno", a.shift_type)}
                  {info("Escala", a.work_shift)}
                  {info("Horário", a.work_schedule)}
                  {info("Horário de chamada", a.call_time)}
                  {info("Horas diárias", a.daily_hours)}
                  {info("Horas semanais", a.weekly_hours)}
                </CardContent>
              </Card>

              {/* Remuneração */}
              <Card>
                <CardHeader><CardTitle className="text-base">Remuneração</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 grid-cols-1">
                    {info("Tipo de remuneração", remunerationTypeLabels[a.remuneration_type] || a.remuneration_type)}
                  </div>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                    <div className="p-3 rounded-md bg-primary/5 border border-primary/20">
                      <p className="text-xs text-muted-foreground">{a.remuneration_type ? getEffectiveLabel(a.remuneration_type) : "Valor efetivo do evento"}</p>
                      <p className="text-lg font-semibold text-foreground">{formatCurrency(getEffectiveValue(a))}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Pagamento real neste evento</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50 border border-border">
                      <p className="text-xs text-muted-foreground">Valor de referência da categoria</p>
                      <p className="text-lg font-semibold text-foreground">{formatCurrency(a.category_reference_rate)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Referência do cargo — não é o pagamento</p>
                    </div>
                  </div>
                  {info("Frequência de pagamento", a.payment_frequency)}
                </CardContent>
              </Card>

              {/* Benefícios */}
              <Card>
                <CardHeader><CardTitle className="text-base">Benefícios</CardTitle></CardHeader>
                <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {info("Vale-transporte (VT)", a.has_transport_allowance ? formatCurrency(a.transport_allowance) : "Não")}
                  {info("Vale-refeição/alimentação (VR/VA)", a.has_meal_allowance ? formatCurrency(a.meal_allowance) : "Não")}
                </CardContent>
              </Card>

              {/* Observações */}
              {a.notes && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
                  <CardContent><p className="text-sm whitespace-pre-wrap">{a.notes}</p></CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="conformidade" className="mt-4">
          {employmentLinkId ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <LinkComplianceCard linkId={employmentLinkId} />
              <ComplianceTimeline linkId={employmentLinkId} />
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Alocação sem vínculo formal</AlertTitle>
              <AlertDescription>
                Esta alocação legada ainda não está associada a um vínculo formal (employment_link).
                A conformidade e os documentos contextuais permanecem indisponíveis até que um administrador execute o reparo.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          {employmentLinkId ? (
            <LinkDocumentsTab
              workerId={workerId!}
              employmentLinkId={employmentLinkId}
              linkGroupWorkerId={a.id}
              event={g.events}
              workerName={worker?.full_name || ""}
              workerCpf={worker?.cpf}
              requiredDocuments={g.required_documents}
            />
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Documentos indisponíveis</AlertTitle>
              <AlertDescription>
                Esta alocação ainda não está associada a um vínculo formal. Reparar antes de gerenciar documentos contextuais.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
