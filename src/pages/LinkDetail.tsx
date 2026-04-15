import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useLinkGroup, useLinkGroupWorkers, useAllocateWorker, useRemoveGroupWorker } from "@/hooks/useLinkGroups";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Pencil, Loader2, Trash2, Plus, UserMinus, Download, FileText, FolderArchive } from "lucide-react";
import { exportGroupXlsx, exportGroupPdf } from "@/lib/export-group";
import { exportGroupDocsZip } from "@/lib/export-docs-zip";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useDeleteRecord } from "@/hooks/useDeleteRecord";
import { toast } from "sonner";

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
  clt: "CLT",
  service: "Prestação de serviço",
  both: "Ambos (CLT e Prestação)",
};

const remunerationTypeOptions = [
  { value: "cache", label: "Cachê" },
  { value: "daily", label: "Diária" },
  { value: "hourly", label: "Hora" },
  { value: "fixed", label: "Salário fixo" },
];

const formatDateBR = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const formatCurrency = (v: number | null | undefined) => {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
};

function useAllWorkers() {
  return useQuery({
    queryKey: ["workers-all-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workers")
        .select("id, full_name, nickname, cpf")
        .is("deleted_at", null)
        .order("full_name")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

function getContractOptions(allowed: string) {
  if (allowed === "clt") return [{ value: "clt", label: "CLT" }];
  if (allowed === "service") return [{ value: "service", label: "Prestação de serviço" }];
  return [{ value: "clt", label: "CLT" }, { value: "service", label: "Prestação de serviço" }];
}

function getEffectiveValueLabel(remunerationType: string) {
  switch (remunerationType) {
    case "cache": return "Valor do cachê";
    case "daily": return "Valor da diária";
    case "hourly": return "Valor da hora";
    case "fixed": return "Valor do salário fixo";
    default: return "Valor efetivo";
  }
}

function getEffectiveValueField(remunerationType: string) {
  switch (remunerationType) {
    case "daily": return "daily_rate";
    case "hourly": return "hourly_rate";
    case "fixed": return "fixed_salary";
    default: return "daily_rate"; // cachê uses daily_rate
  }
}

const INITIAL_ALLOC = {
  worker_id: "",
  job_role: "",
  job_function: "",
  department: "",
  contract_type: "",
  shift_type: "",
  work_shift: "",
  work_schedule: "",
  call_time: "",
  daily_hours: "",
  weekly_hours: "",
  remuneration_type: "",
  effective_value: "",
  category_reference_rate: "",
  has_transport_allowance: false,
  transport_allowance: "",
  has_meal_allowance: false,
  meal_allowance: "",
  notes: "",
};

export default function LinkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: group, isLoading } = useLinkGroup(id);
  const { data: workers, isLoading: loadingWorkers } = useLinkGroupWorkers(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const canDelete = hasAnyRole(["admin", "manager"]);
  const { deleteRecord, isDeleting } = useDeleteRecord("link_groups", ["link-groups", "link-group", "dashboard-counts"]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAllocate, setShowAllocate] = useState(false);
  const [alloc, setAlloc] = useState({ ...INITIAL_ALLOC });
  const allocateMutation = useAllocateWorker();
  const removeMutation = useRemoveGroupWorker();
  const { data: allWorkers } = useAllWorkers();
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);

  // Remove worker modal
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!group) {
    return <p className="py-8 text-center text-muted-foreground">Grupo não encontrado.</p>;
  }

  const g = group as any;
  const eventName = g.events?.name || "—";
  const companyName = g.companies?.trade_name || g.companies?.legal_name || "—";
  const allowedContracts = g.allowed_contract_types || "both";
  const contractOptions = getContractOptions(allowedContracts);

  const info = (label: string, value: string | number | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value != null && value !== "" ? String(value) : "—"}</p>
    </div>
  );

  const allocatedWorkerIds = new Set((workers ?? []).map((w: any) => w.worker_id));
  const availableWorkers = (allWorkers ?? []).filter((w: any) => !allocatedWorkerIds.has(w.id));

  const setA = (key: string, value: any) => setAlloc((p) => ({ ...p, [key]: value }));

  const handleAllocate = () => {
    if (!alloc.worker_id) {
      toast.error("Selecione um trabalhador");
      return;
    }

    const effectiveField = getEffectiveValueField(alloc.remuneration_type);
    const effectiveValue = alloc.effective_value ? Number(alloc.effective_value) : null;

    const payload: Record<string, any> = {
      link_group_id: id!,
      worker_id: alloc.worker_id,
      job_role: alloc.job_role || null,
      job_function: alloc.job_function || null,
      department: alloc.department || null,
      contract_type: alloc.contract_type || null,
      shift_type: alloc.shift_type || null,
      work_shift: alloc.work_shift || null,
      work_schedule: alloc.work_schedule || null,
      call_time: alloc.call_time || null,
      daily_hours: alloc.daily_hours ? Number(alloc.daily_hours) : null,
      weekly_hours: alloc.weekly_hours ? Number(alloc.weekly_hours) : null,
      remuneration_type: alloc.remuneration_type || null,
      daily_rate: effectiveField === "daily_rate" ? effectiveValue : null,
      hourly_rate: effectiveField === "hourly_rate" ? effectiveValue : null,
      fixed_salary: effectiveField === "fixed_salary" ? effectiveValue : null,
      category_reference_rate: alloc.category_reference_rate ? Number(alloc.category_reference_rate) : null,
      has_transport_allowance: alloc.has_transport_allowance,
      transport_allowance: alloc.has_transport_allowance && alloc.transport_allowance ? Number(alloc.transport_allowance) : null,
      has_meal_allowance: alloc.has_meal_allowance,
      meal_allowance: alloc.has_meal_allowance && alloc.meal_allowance ? Number(alloc.meal_allowance) : null,
      notes: alloc.notes || null,
    };

    allocateMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Trabalhador alocado");
        setShowAllocate(false);
        setAlloc({ ...INITIAL_ALLOC });
      },
      onError: (err: any) => toast.error(err.message || "Erro ao alocar"),
    });
  };

  const handleConfirmRemove = () => {
    if (!removeTarget) return;
    removeMutation.mutate({ id: removeTarget.id, link_group_id: id! }, {
      onSuccess: () => {
        toast.success(`${removeTarget.name} removido do grupo`);
        setRemoveTarget(null);
      },
      onError: (err: any) => toast.error(err.message || "Erro ao remover"),
    });
  };

  const getWorkerEffectiveValue = (w: any) => {
    if (w.remuneration_type === "hourly") return w.hourly_rate;
    if (w.remuneration_type === "fixed") return w.fixed_salary;
    return w.daily_rate; // cachê or daily
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
              <h1 className="text-xl font-semibold text-foreground">{g.group_name}</h1>
              <Badge variant={statusVariant(g.status)}>{statusLabels[g.status] || g.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{eventName} · {companyName}</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => navigate(`/links/${id}/edit`)}>
              <Pencil className="mr-1 h-3 w-3" /> Editar
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Excluir grupo"
        description={`Tem certeza que deseja excluir o grupo "${g.group_name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => deleteRecord(g.id, { onSuccess: () => navigate("/links") })}
        isDeleting={isDeleting}
      />

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="trabalhadores">
            Trabalhadores {workers && <Badge variant="secondary" className="ml-1 text-xs">{workers.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Nome do grupo", g.group_name)}
              {info("Evento", eventName)}
              {info("Empresa", companyName)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contrato</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Status", statusLabels[g.status] || g.status)}
              {info("Tipo de contratação", contractTypeLabels[allowedContracts] || allowedContracts)}
              {info("Data início", formatDateBR(g.hire_date))}
              {info("Data fim", formatDateBR(g.end_date))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Dias de atuação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-1">
              {info("Modo", g.work_days_mode === "specific_dates" ? "Datas específicas" : "Contínuo")}
              {g.work_days_mode === "specific_dates" && g.specific_work_dates?.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Datas de atuação</p>
                  <div className="flex flex-wrap gap-1">
                    {g.specific_work_dates.map((d: string) => (
                      <Badge key={d} variant="secondary">{formatDateBR(d)}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {info("Observações da escala", g.work_days_notes)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Operacional</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Supervisor", g.supervisor_name)}
              {info("Ponto de encontro", g.assembly_point)}
              {info("Uniforme", g.uniform_notes)}
              {info("Transporte", g.transport_notes)}
              {info("Refeição", g.meal_entitlement)}
            </CardContent>
          </Card>

          {g.notes && (
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-wrap">{g.notes}</p></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="trabalhadores" className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={!workers?.length || exportingXlsx}
                onClick={async () => {
                  setExportingXlsx(true);
                  try {
                    const period = g.hire_date || g.end_date ? `${formatDateBR(g.hire_date)} – ${formatDateBR(g.end_date)}` : "";
                    await exportGroupXlsx({ groupId: id!, groupName: g.group_name, eventName, companyName, period });
                    toast.success("Excel exportado com sucesso");
                  } catch (err: any) { toast.error(err.message || "Erro ao exportar Excel"); }
                  finally { setExportingXlsx(false); }
                }}>
                {exportingXlsx ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />} Excel
              </Button>
              <Button size="sm" variant="outline" disabled={!workers?.length || exportingPdf}
                onClick={async () => {
                  setExportingPdf(true);
                  try {
                    const period = g.hire_date || g.end_date ? `${formatDateBR(g.hire_date)} – ${formatDateBR(g.end_date)}` : "";
                    await exportGroupPdf({ groupId: id!, groupName: g.group_name, eventName, companyName, period });
                    toast.success("PDF exportado com sucesso");
                  } catch (err: any) { toast.error(err.message || "Erro ao exportar PDF"); }
                  finally { setExportingPdf(false); }
                }}>
                {exportingPdf ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileText className="mr-1 h-3 w-3" />} PDF
              </Button>
              <Button size="sm" variant="outline" disabled={!workers?.length || exportingZip}
                onClick={async () => {
                  setExportingZip(true);
                  try {
                    const workerList = (workers || []).map((w: any) => ({
                      workerId: w.worker_id,
                      linkGroupWorkerId: w.id,
                      fullName: w.workers?.full_name || "",
                      cpf: w.workers?.cpf || "",
                    }));
                    const count = await exportGroupDocsZip({ groupName: g.group_name, workers: workerList });
                    toast.success(`ZIP gerado com ${count} arquivo(s)`);
                  } catch (err: any) { toast.error(err.message || "Erro ao gerar ZIP"); }
                  finally { setExportingZip(false); }
                }}>
                {exportingZip ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderArchive className="mr-1 h-3 w-3" />} ZIP
              </Button>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setShowAllocate(true)}>
                <Plus className="mr-1 h-3 w-3" /> Alocar trabalhador
              </Button>
            )}
          </div>

          {loadingWorkers ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !workers?.length ? (
            <p className="py-6 text-center text-muted-foreground">Nenhum trabalhador alocado neste grupo.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabalhador</TableHead>
                    <TableHead className="hidden sm:table-cell">Função</TableHead>
                    <TableHead className="hidden md:table-cell">Valor efetivo</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers.map((w: any) => {
                    const wName = w.workers?.full_name || "—";
                    const wNick = w.workers?.nickname;
                    const effectiveVal = getWorkerEffectiveValue(w);
                    return (
                      <TableRow key={w.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/links/${id}/workers/${w.worker_id}`)}>
                        <TableCell>
                          <p className="text-sm font-medium">{wName}{wNick ? ` (${wNick})` : ""}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{w.job_role || ""}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{w.job_role || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{formatCurrency(effectiveVal)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(w.status)}>{statusLabels[w.status] || w.status}</Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => { e.stopPropagation(); setRemoveTarget({ id: w.id, name: wName }); }}
                              disabled={removeMutation.isPending}
                            >
                              <UserMinus className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Remove Worker Modal */}
      <DeleteConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="Remover do grupo"
        description={`Tem certeza que deseja remover "${removeTarget?.name}" deste grupo? O trabalhador não será excluído do sistema, apenas desvinculado.`}
        onConfirm={handleConfirmRemove}
        isDeleting={removeMutation.isPending}
      />

      {/* Allocate Worker Dialog */}
      <Dialog open={showAllocate} onOpenChange={setShowAllocate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alocar trabalhador</DialogTitle>
            <DialogDescription>Preencha os dados individuais do trabalhador neste grupo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {/* Identificação */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Identificação</h4>
              <div>
                <Label>Trabalhador *</Label>
                <Select value={alloc.worker_id} onValueChange={(v) => setA("worker_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {availableWorkers.map((w: any) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.full_name}{w.nickname ? ` (${w.nickname})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Função/Cargo</Label>
                  <Input value={alloc.job_role} onChange={(e) => setA("job_role", e.target.value)} />
                </div>
                <div>
                  <Label>Atividade</Label>
                  <Input value={alloc.job_function} onChange={(e) => setA("job_function", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Departamento</Label>
                  <Input value={alloc.department} onChange={(e) => setA("department", e.target.value)} />
                </div>
                <div>
                  <Label>Tipo de contrato</Label>
                  <Select value={alloc.contract_type} onValueChange={(v) => setA("contract_type", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {contractOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Jornada */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Jornada</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Turno</Label>
                  <Input value={alloc.shift_type} onChange={(e) => setA("shift_type", e.target.value)} placeholder="Ex: Diurno" />
                </div>
                <div>
                  <Label>Escala</Label>
                  <Input value={alloc.work_shift} onChange={(e) => setA("work_shift", e.target.value)} placeholder="Ex: 6x1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Horário</Label>
                  <Input value={alloc.work_schedule} onChange={(e) => setA("work_schedule", e.target.value)} placeholder="Ex: 08:00-17:00" />
                </div>
                <div>
                  <Label>Horário de chamada</Label>
                  <Input type="time" value={alloc.call_time} onChange={(e) => setA("call_time", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Horas diárias</Label>
                  <Input type="number" step="0.5" value={alloc.daily_hours} onChange={(e) => setA("daily_hours", e.target.value)} />
                </div>
                <div>
                  <Label>Horas semanais</Label>
                  <Input type="number" step="0.5" value={alloc.weekly_hours} onChange={(e) => setA("weekly_hours", e.target.value)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Remuneração */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Remuneração</h4>
              <div>
                <Label>Tipo de remuneração</Label>
                <Select value={alloc.remuneration_type} onValueChange={(v) => setA("remuneration_type", v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {remunerationTypeOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{alloc.remuneration_type ? getEffectiveValueLabel(alloc.remuneration_type) : "Valor efetivo do evento"}</Label>
                <Input type="number" step="0.01" min="0" value={alloc.effective_value} onChange={(e) => setA("effective_value", e.target.value)} placeholder="R$ 0,00" />
                <p className="text-xs text-muted-foreground mt-1">Valor que o trabalhador vai receber neste evento.</p>
              </div>
            </div>

            <Separator />

            {/* Referência */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Referência da categoria/cargo</h4>
              <div>
                <Label>Valor de referência</Label>
                <Input type="number" step="0.01" min="0" value={alloc.category_reference_rate} onChange={(e) => setA("category_reference_rate", e.target.value)} placeholder="R$ 0,00" />
                <p className="text-xs text-muted-foreground mt-1">Salário/cachê de referência da função — não é o pagamento real.</p>
              </div>
            </div>

            <Separator />

            {/* Benefícios */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Benefícios</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vale-transporte (VT)</Label>
                  <Switch checked={alloc.has_transport_allowance} onCheckedChange={(v) => setA("has_transport_allowance", v)} />
                </div>
                {alloc.has_transport_allowance && (
                  <Input type="number" step="0.01" min="0" value={alloc.transport_allowance} onChange={(e) => setA("transport_allowance", e.target.value)} placeholder="Valor do VT" />
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vale-refeição / alimentação (VR/VA)</Label>
                  <Switch checked={alloc.has_meal_allowance} onCheckedChange={(v) => setA("has_meal_allowance", v)} />
                </div>
                {alloc.has_meal_allowance && (
                  <Input type="number" step="0.01" min="0" value={alloc.meal_allowance} onChange={(e) => setA("meal_allowance", e.target.value)} placeholder="Valor do VR/VA" />
                )}
              </div>
            </div>

            <Separator />

            {/* Observações */}
            <div>
              <Label>Observações</Label>
              <Textarea value={alloc.notes} onChange={(e) => setA("notes", e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAllocate(false)}>Cancelar</Button>
            <Button onClick={handleAllocate} disabled={allocateMutation.isPending}>
              {allocateMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Alocar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
