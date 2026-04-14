import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Pencil, Loader2, Trash2, Plus, UserMinus } from "lucide-react";
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

const formatDateBR = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
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
  const [allocWorker, setAllocWorker] = useState("");
  const [allocRole, setAllocRole] = useState("");
  const [allocFunction, setAllocFunction] = useState("");
  const allocateMutation = useAllocateWorker();
  const removeMutation = useRemoveGroupWorker();
  const { data: allWorkers } = useAllWorkers();

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!group) {
    return <p className="py-8 text-center text-muted-foreground">Grupo não encontrado.</p>;
  }

  const g = group as any;
  const eventName = g.events?.name || "—";
  const companyName = g.companies?.trade_name || g.companies?.legal_name || "—";

  const info = (label: string, value: string | number | null | undefined) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value != null && value !== "" ? String(value) : "—"}</p>
    </div>
  );

  const allocatedWorkerIds = new Set((workers ?? []).map((w: any) => w.worker_id));
  const availableWorkers = (allWorkers ?? []).filter((w: any) => !allocatedWorkerIds.has(w.id));

  const handleAllocate = () => {
    if (!allocWorker) {
      toast.error("Selecione um trabalhador");
      return;
    }
    allocateMutation.mutate({
      link_group_id: id!,
      worker_id: allocWorker,
      job_role: allocRole || null,
      job_function: allocFunction || null,
    }, {
      onSuccess: () => {
        toast.success("Trabalhador alocado");
        setShowAllocate(false);
        setAllocWorker("");
        setAllocRole("");
        setAllocFunction("");
      },
      onError: (err: any) => toast.error(err.message || "Erro ao alocar"),
    });
  };

  const handleRemoveWorker = (workerId: string, workerName: string, recordId: string) => {
    if (!confirm(`Remover ${workerName} do grupo?`)) return;
    removeMutation.mutate({ id: recordId, link_group_id: id! }, {
      onSuccess: () => toast.success(`${workerName} removido do grupo`),
      onError: (err: any) => toast.error(err.message || "Erro ao remover"),
    });
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
              {info("Data início", formatDateBR(g.hire_date))}
              {info("Data fim", formatDateBR(g.end_date))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Jornada</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("Turno", g.shift_type)}
              {info("Escala", g.work_shift)}
              {info("Horário", g.work_schedule)}
              {info("Horário de chamada", g.call_time)}
              {info("Horas diárias", g.daily_hours)}
              {info("Horas semanais", g.weekly_hours)}
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
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowAllocate(true)}>
                <Plus className="mr-1 h-3 w-3" /> Alocar trabalhador
              </Button>
            </div>
          )}

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
                    <TableHead className="hidden md:table-cell">Atividade</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers.map((w: any) => {
                    const wName = w.workers?.full_name || "—";
                    const wNick = w.workers?.nickname;
                    return (
                      <TableRow key={w.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{wName}{wNick ? ` (${wNick})` : ""}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{w.job_role || ""}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{w.job_role || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{w.job_function || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(w.status)}>{statusLabels[w.status] || w.status}</Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveWorker(w.worker_id, wName, w.id)}
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

      {/* Allocate Worker Dialog */}
      <Dialog open={showAllocate} onOpenChange={setShowAllocate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alocar trabalhador</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Trabalhador *</Label>
              <Select value={allocWorker} onValueChange={setAllocWorker}>
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
            <div>
              <Label>Função/Cargo</Label>
              <Input value={allocRole} onChange={(e) => setAllocRole(e.target.value)} />
            </div>
            <div>
              <Label>Atividade</Label>
              <Input value={allocFunction} onChange={(e) => setAllocFunction(e.target.value)} />
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
