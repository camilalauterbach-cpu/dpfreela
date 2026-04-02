import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmploymentLink } from "@/hooks/useEmploymentLinks";
import { useWorkers } from "@/hooks/useWorkers";
import { useEvents } from "@/hooks/useEvents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Save, X } from "lucide-react";

export default function LinkForm() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: existing, isLoading: loadingExisting } = useEmploymentLink(id);
  const { data: workers } = useWorkers("");
  const { data: events } = useEvents("", "all");

  const [form, setForm] = useState<Record<string, any>>({
    link_name: "",
    worker_id: searchParams.get("worker") || "",
    event_id: searchParams.get("event") || "",
    job_role: "",
    job_function: "",
    department: "",
    contract_type: "",
    status: "draft",
    hire_date: "",
    end_date: "",
    shift_type: "",
    work_shift: "",
    work_schedule: "",
    call_time: "",
    daily_hours: "",
    weekly_hours: "",
    work_days_mode: "continuous",
    specific_work_dates: [] as string[],
    work_days_notes: "",
    supervisor_name: "",
    assembly_point: "",
    uniform_notes: "",
    transport_notes: "",
    meal_entitlement: "",
    daily_rate: "",
    hourly_rate: "",
    fixed_salary: "",
    payment_frequency: "",
    notes: "",
  });

  const [newDate, setNewDate] = useState("");
  const [highlightDates, setHighlightDates] = useState(false);
  const hireDateRef = useRef<HTMLInputElement>(null);
  const contractSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isEdit && existing) {
      const e = existing as any;
      setForm({
        link_name: e.link_name || "",
        worker_id: e.worker_id || "",
        event_id: e.event_id || "",
        job_role: e.job_role || "",
        job_function: e.job_function || "",
        department: e.department || "",
        contract_type: e.contract_type || "",
        status: e.status || "draft",
        hire_date: e.hire_date || "",
        end_date: e.end_date || "",
        shift_type: e.shift_type || "",
        work_shift: e.work_shift || "",
        work_schedule: e.work_schedule || "",
        call_time: e.call_time || "",
        daily_hours: e.daily_hours != null ? String(e.daily_hours) : "",
        weekly_hours: e.weekly_hours != null ? String(e.weekly_hours) : "",
        work_days_mode: e.work_days_mode || "continuous",
        specific_work_dates: e.specific_work_dates || [],
        work_days_notes: e.work_days_notes || "",
        supervisor_name: e.supervisor_name || "",
        assembly_point: e.assembly_point || "",
        uniform_notes: e.uniform_notes || "",
        transport_notes: e.transport_notes || "",
        meal_entitlement: e.meal_entitlement || "",
        daily_rate: e.daily_rate != null ? String(e.daily_rate) : "",
        hourly_rate: e.hourly_rate != null ? String(e.hourly_rate) : "",
        fixed_salary: e.fixed_salary != null ? String(e.fixed_salary) : "",
        payment_frequency: e.payment_frequency || "",
        notes: e.notes || "",
      });
    }
  }, [isEdit, existing]);

  const set = (key: string, value: any) => setForm((p) => ({ ...p, [key]: value }));

  const addSpecificDate = () => {
    if (!newDate) return;
    if (form.hire_date && newDate < form.hire_date) {
      toast({ title: "Data fora do período", description: "A data deve ser igual ou posterior à data de início.", variant: "destructive" });
      return;
    }
    if (form.end_date && newDate > form.end_date) {
      toast({ title: "Data fora do período", description: "A data deve ser igual ou anterior à data de fim.", variant: "destructive" });
      return;
    }
    if (form.specific_work_dates.includes(newDate)) {
      toast({ title: "Data duplicada", variant: "destructive" });
      return;
    }
    const updated = [...form.specific_work_dates, newDate].sort();
    set("specific_work_dates", updated);
    setNewDate("");
  };

  const removeSpecificDate = (d: string) => {
    set("specific_work_dates", form.specific_work_dates.filter((x: string) => x !== d));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        link_name: form.link_name || null,
        worker_id: form.worker_id,
        event_id: form.event_id || null,
        job_role: form.job_role || null,
        job_function: form.job_function || null,
        department: form.department || null,
        contract_type: form.contract_type || null,
        status: form.status,
        hire_date: form.hire_date || null,
        end_date: form.end_date || null,
        shift_type: form.shift_type || null,
        work_shift: form.work_shift || null,
        work_schedule: form.work_schedule || null,
        call_time: form.call_time || null,
        daily_hours: form.daily_hours ? Number(form.daily_hours) : null,
        weekly_hours: form.weekly_hours ? Number(form.weekly_hours) : null,
        work_days_mode: form.work_days_mode,
        specific_work_dates: form.work_days_mode === "specific_dates" ? form.specific_work_dates : [],
        work_days_notes: form.work_days_notes || null,
        supervisor_name: form.supervisor_name || null,
        assembly_point: form.assembly_point || null,
        uniform_notes: form.uniform_notes || null,
        transport_notes: form.transport_notes || null,
        meal_entitlement: form.meal_entitlement || null,
        daily_rate: form.daily_rate ? Number(form.daily_rate) : null,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
        fixed_salary: form.fixed_salary ? Number(form.fixed_salary) : null,
        payment_frequency: form.payment_frequency || null,
        notes: form.notes || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("employment_links").update(payload as any).eq("id", id!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employment_links").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employment-links"] });
      queryClient.invalidateQueries({ queryKey: ["employment-link"] });
      toast({ title: isEdit ? "Vínculo atualizado" : "Vínculo criado" });
      navigate("/links");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err?.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.link_name.trim()) {
      toast({ title: "Nome do vínculo é obrigatório", variant: "destructive" });
      return;
    }
    if (!form.worker_id) {
      toast({ title: "Selecione um trabalhador", variant: "destructive" });
      return;
    }
    if (!form.hire_date) {
      toast({ title: "Data de início é obrigatória", variant: "destructive" });
      return;
    }
    if (!form.end_date) {
      toast({ title: "Data de fim é obrigatória", variant: "destructive" });
      return;
    }
    if (form.end_date < form.hire_date) {
      toast({ title: "Data de fim deve ser posterior à data de início", variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const formatDateBR = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/links")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">
          {isEdit ? "Editar vínculo" : "Novo vínculo"}
        </h1>
      </div>

      {/* Identificação */}
      <Card>
        <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nome do vínculo *</Label>
            <Input value={form.link_name} onChange={(e) => set("link_name", e.target.value)} placeholder="Ex: Segurança — Festival Salvador 2026" required />
          </div>
          <div>
            <Label>Trabalhador *</Label>
            <Select value={form.worker_id} onValueChange={(v) => set("worker_id", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(workers as any[])?.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.full_name}{w.nickname ? ` (${w.nickname})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Evento</Label>
            <Select value={form.event_id} onValueChange={(v) => set("event_id", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(events as any[])?.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Função/Cargo</Label>
            <Input value={form.job_role} onChange={(e) => set("job_role", e.target.value)} />
          </div>
          <div>
            <Label>Atividade</Label>
            <Input value={form.job_function} onChange={(e) => set("job_function", e.target.value)} />
          </div>
          <div>
            <Label>Departamento</Label>
            <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Contrato */}
      <Card ref={contractSectionRef}>
        <CardHeader><CardTitle className="text-base">Contrato</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div>
            <Label>Tipo de contrato</Label>
            <Select value={form.contract_type} onValueChange={(v) => set("contract_type", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="clt">CLT</SelectItem>
                <SelectItem value="pj">PJ</SelectItem>
                <SelectItem value="freelancer">Freelancer</SelectItem>
                <SelectItem value="temporary">Temporário</SelectItem>
                <SelectItem value="intern">Estagiário</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="suspended">Suspenso</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
                <SelectItem value="terminated">Encerrado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={highlightDates && !form.hire_date ? "text-destructive font-semibold" : ""}>
              Data início *
              {highlightDates && !form.hire_date && <span className="ml-1 text-xs font-normal">← preencha aqui</span>}
            </Label>
            <Input
              ref={hireDateRef}
              type="date"
              value={form.hire_date}
              onChange={(e) => { set("hire_date", e.target.value); if (e.target.value && form.end_date) setHighlightDates(false); }}
              required
              className={highlightDates && !form.hire_date ? "border-destructive ring-2 ring-destructive/30" : ""}
            />
          </div>
          <div>
            <Label className={highlightDates && !form.end_date ? "text-destructive font-semibold" : ""}>
              Data fim *
              {highlightDates && !form.end_date && <span className="ml-1 text-xs font-normal">← preencha aqui</span>}
            </Label>
            <Input
              type="date"
              value={form.end_date}
              onChange={(e) => { set("end_date", e.target.value); if (form.hire_date && e.target.value) setHighlightDates(false); }}
              required
              className={highlightDates && !form.end_date ? "border-destructive ring-2 ring-destructive/30" : ""}
            />
          </div>
        </CardContent>
      </Card>

      {/* Jornada */}
      <Card>
        <CardHeader><CardTitle className="text-base">Jornada</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Turno</Label>
            <Input value={form.shift_type} onChange={(e) => set("shift_type", e.target.value)} placeholder="Ex: Diurno" />
          </div>
          <div>
            <Label>Escala</Label>
            <Input value={form.work_shift} onChange={(e) => set("work_shift", e.target.value)} placeholder="Ex: 6x1" />
          </div>
          <div>
            <Label>Horário</Label>
            <Input value={form.work_schedule} onChange={(e) => set("work_schedule", e.target.value)} placeholder="Ex: 08:00-17:00" />
          </div>
          <div>
            <Label>Horário de chamada</Label>
            <Input type="time" value={form.call_time} onChange={(e) => set("call_time", e.target.value)} />
          </div>
          <div>
            <Label>Horas diárias</Label>
            <Input type="number" step="0.5" value={form.daily_hours} onChange={(e) => set("daily_hours", e.target.value)} />
          </div>
          <div>
            <Label>Horas semanais</Label>
            <Input type="number" step="0.5" value={form.weekly_hours} onChange={(e) => set("weekly_hours", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Modo de dias */}
      <Card>
        <CardHeader><CardTitle className="text-base">Dias de atuação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Modo</Label>
            <Select value={form.work_days_mode} onValueChange={(v) => set("work_days_mode", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="continuous">Contínuo (todos os dias do período)</SelectItem>
                <SelectItem value="specific_dates">Datas específicas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.work_days_mode === "specific_dates" && (
            <div className="space-y-2">
              <Label>Datas de atuação</Label>
              {!form.hire_date || !form.end_date ? (
                <p className="text-xs text-muted-foreground">Preencha as datas de início e fim primeiro.</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      min={form.hire_date}
                      max={form.end_date}
                      className="flex-1"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addSpecificDate}>
                      Adicionar
                    </Button>
                  </div>
                  {form.specific_work_dates.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {form.specific_work_dates.map((d: string) => (
                        <Badge key={d} variant="secondary" className="gap-1">
                          {formatDateBR(d)}
                          <button type="button" onClick={() => removeSpecificDate(d)} className="hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <Label>Observações da escala</Label>
            <Textarea value={form.work_days_notes} onChange={(e) => set("work_days_notes", e.target.value)} rows={2} placeholder="Ex: Folga nos dias de montagem" />
          </div>
        </CardContent>
      </Card>

      {/* Operacional */}
      <Card>
        <CardHeader><CardTitle className="text-base">Operacional</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div>
            <Label>Supervisor</Label>
            <Input value={form.supervisor_name} onChange={(e) => set("supervisor_name", e.target.value)} />
          </div>
          <div>
            <Label>Ponto de encontro</Label>
            <Input value={form.assembly_point} onChange={(e) => set("assembly_point", e.target.value)} />
          </div>
          <div>
            <Label>Uniforme</Label>
            <Input value={form.uniform_notes} onChange={(e) => set("uniform_notes", e.target.value)} />
          </div>
          <div>
            <Label>Transporte</Label>
            <Input value={form.transport_notes} onChange={(e) => set("transport_notes", e.target.value)} />
          </div>
          <div>
            <Label>Refeição</Label>
            <Input value={form.meal_entitlement} onChange={(e) => set("meal_entitlement", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Remuneração */}
      <Card>
        <CardHeader><CardTitle className="text-base">Remuneração</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Diária (R$)</Label>
            <Input type="number" step="0.01" value={form.daily_rate} onChange={(e) => set("daily_rate", e.target.value)} />
          </div>
          <div>
            <Label>Hora (R$)</Label>
            <Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} />
          </div>
          <div>
            <Label>Salário fixo (R$)</Label>
            <Input type="number" step="0.01" value={form.fixed_salary} onChange={(e) => set("fixed_salary", e.target.value)} />
          </div>
          <div>
            <Label>Frequência de pagamento</Label>
            <Select value={form.payment_frequency} onValueChange={(v) => set("payment_frequency", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diária</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="biweekly">Quinzenal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
                <SelectItem value="per_event">Por evento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Observações */}
      <Card>
        <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="outline" onClick={() => navigate("/links")}>Cancelar</Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </form>
  );
}
