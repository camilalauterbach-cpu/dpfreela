import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateGroupWorker } from "@/hooks/useLinkGroups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

interface Props {
  allocation: any;
  groupId: string;
  onSaved?: () => void;
}

export function AllocationEditForm({ allocation, groupId, onSaved }: Props) {
  const { toast } = useToast();
  const updateMutation = useUpdateGroupWorker();

  const [form, setForm] = useState({
    job_role: allocation.job_role || "",
    job_function: allocation.job_function || "",
    department: allocation.department || "",
    contract_type: allocation.contract_type || "",
    shift_type: allocation.shift_type || "",
    work_shift: allocation.work_shift || "",
    work_schedule: allocation.work_schedule || "",
    call_time: allocation.call_time || "",
    daily_hours: allocation.daily_hours ?? "",
    weekly_hours: allocation.weekly_hours ?? "",
    remuneration_type: allocation.remuneration_type || "",
    daily_rate: allocation.daily_rate ?? "",
    hourly_rate: allocation.hourly_rate ?? "",
    fixed_salary: allocation.fixed_salary ?? "",
    category_reference_rate: allocation.category_reference_rate ?? "",
    has_transport_allowance: allocation.has_transport_allowance || false,
    transport_allowance: allocation.transport_allowance ?? "",
    has_meal_allowance: allocation.has_meal_allowance || false,
    meal_allowance: allocation.meal_allowance ?? "",
    payment_frequency: allocation.payment_frequency || "",
    hire_date: allocation.hire_date || "",
    end_date: allocation.end_date || "",
    status: allocation.status || "active",
    notes: allocation.notes || "",
  });

  const set = (key: string, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const payload: Record<string, any> = {
      id: allocation.id,
      link_group_id: groupId,
      job_role: form.job_role || null,
      job_function: form.job_function || null,
      department: form.department || null,
      contract_type: form.contract_type || null,
      shift_type: form.shift_type || null,
      work_shift: form.work_shift || null,
      work_schedule: form.work_schedule || null,
      call_time: form.call_time || null,
      daily_hours: form.daily_hours !== "" ? Number(form.daily_hours) : null,
      weekly_hours: form.weekly_hours !== "" ? Number(form.weekly_hours) : null,
      remuneration_type: form.remuneration_type || null,
      daily_rate: form.daily_rate !== "" ? Number(form.daily_rate) : null,
      hourly_rate: form.hourly_rate !== "" ? Number(form.hourly_rate) : null,
      fixed_salary: form.fixed_salary !== "" ? Number(form.fixed_salary) : null,
      category_reference_rate: form.category_reference_rate !== "" ? Number(form.category_reference_rate) : null,
      has_transport_allowance: form.has_transport_allowance,
      transport_allowance: form.has_transport_allowance && form.transport_allowance !== "" ? Number(form.transport_allowance) : null,
      has_meal_allowance: form.has_meal_allowance,
      meal_allowance: form.has_meal_allowance && form.meal_allowance !== "" ? Number(form.meal_allowance) : null,
      payment_frequency: form.payment_frequency || null,
      hire_date: form.hire_date || null,
      end_date: form.end_date || null,
      status: form.status,
      notes: form.notes || null,
    };

    updateMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Alocação atualizada" });
        onSaved?.();
      },
      onError: (err: any) => {
        toast({ title: "Erro ao salvar", description: err?.message, variant: "destructive" });
      },
    });
  };

  const field = (label: string, key: string, type = "text", placeholder = "") => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={(form as any)[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="space-y-1">
        <Label className="text-xs">Status da alocação</Label>
        <Select value={form.status} onValueChange={(v) => set("status", v)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="suspended">Suspenso</SelectItem>
            <SelectItem value="completed">Concluído</SelectItem>
            <SelectItem value="terminated">Encerrado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contrato */}
      <div>
        <h4 className="text-sm font-medium mb-3">Contrato</h4>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de contrato</Label>
            <Select value={form.contract_type} onValueChange={(v) => set("contract_type", v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clt">CLT</SelectItem>
                <SelectItem value="service">Prestação de serviço</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field("Função/Cargo", "job_role")}
          {field("Atividade", "job_function")}
          {field("Departamento", "department")}
          {field("Data início", "hire_date", "date")}
          {field("Data fim", "end_date", "date")}
        </div>
      </div>

      {/* Jornada */}
      <div>
        <h4 className="text-sm font-medium mb-3">Jornada</h4>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {field("Turno", "shift_type")}
          {field("Escala", "work_shift")}
          {field("Horário", "work_schedule", "text", "Ex: 08:00-17:00")}
          {field("Horário de chamada", "call_time", "time")}
          {field("Horas diárias", "daily_hours", "number")}
          {field("Horas semanais", "weekly_hours", "number")}
        </div>
      </div>

      {/* Remuneração */}
      <div>
        <h4 className="text-sm font-medium mb-3">Remuneração</h4>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de remuneração</Label>
            <Select value={form.remuneration_type} onValueChange={(v) => set("remuneration_type", v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cache">Cachê</SelectItem>
                <SelectItem value="daily">Diária</SelectItem>
                <SelectItem value="hourly">Hora</SelectItem>
                <SelectItem value="fixed">Salário fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.remuneration_type === "daily" || form.remuneration_type === "cache"
            ? field("Valor da diária/cachê (R$)", "daily_rate", "number")
            : null}
          {form.remuneration_type === "hourly"
            ? field("Valor da hora (R$)", "hourly_rate", "number")
            : null}
          {form.remuneration_type === "fixed"
            ? field("Salário fixo (R$)", "fixed_salary", "number")
            : null}
          {field("Valor referência da categoria (R$)", "category_reference_rate", "number")}
          {field("Frequência de pagamento", "payment_frequency")}
        </div>
      </div>

      {/* Benefícios */}
      <div>
        <h4 className="text-sm font-medium mb-3">Benefícios</h4>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label className="text-xs">Vale-transporte (VT)</Label>
            <Switch checked={form.has_transport_allowance} onCheckedChange={(v) => set("has_transport_allowance", v)} />
          </div>
          {form.has_transport_allowance && field("Valor VT (R$)", "transport_allowance", "number")}

          <div className="flex items-center justify-between gap-4">
            <Label className="text-xs">Vale-refeição/alimentação (VR/VA)</Label>
            <Switch checked={form.has_meal_allowance} onCheckedChange={(v) => set("has_meal_allowance", v)} />
          </div>
          {form.has_meal_allowance && field("Valor VR/VA (R$)", "meal_allowance", "number")}
        </div>
      </div>

      {/* Observações */}
      <div className="space-y-1">
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          className="text-sm"
        />
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}
