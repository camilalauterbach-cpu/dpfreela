import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, X, Loader2 } from "lucide-react";

interface Props {
  batchId: string;
  eventId: string | null;
  existing?: any;
  onClose: () => void;
}

export function PayrollItemForm({ batchId, eventId, existing, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!existing;

  const [workerId, setWorkerId] = useState<string>(existing?.worker_id || "");
  const [linkId, setLinkId] = useState<string>(existing?.employment_link_id || "");
  const [baseAmount, setBaseAmount] = useState(existing?.base_amount?.toString() || "0");
  const [overtimeAmount, setOvertimeAmount] = useState(existing?.overtime_amount?.toString() || "0");
  const [bonuses, setBonuses] = useState(existing?.bonuses?.toString() || "0");
  const [deductions, setDeductions] = useState(existing?.deductions?.toString() || "0");
  const [notes, setNotes] = useState(existing?.notes || "");

  const net = (Number(baseAmount) || 0) + (Number(overtimeAmount) || 0) + (Number(bonuses) || 0) - (Number(deductions) || 0);

  const { data: workers } = useQuery({
    queryKey: ["workers-all-select"],
    enabled: !isEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workers")
        .select("id, full_name, nickname")
        .is("deleted_at", null)
        .order("full_name")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: eventLinks } = useQuery({
    queryKey: ["event-links-for-worker", eventId, workerId],
    enabled: !isEdit && !!workerId,
    queryFn: async () => {
      let q = supabase
        .from("employment_links")
        .select("id, link_name, job_role, daily_rate, fixed_salary")
        .is("deleted_at", null)
        .eq("worker_id", workerId);
      if (eventId) q = q.eq("event_id", eventId);
      const { data, error } = await q.limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        base_amount: Number(baseAmount) || 0,
        overtime_amount: Number(overtimeAmount) || 0,
        bonuses: Number(bonuses) || 0,
        deductions: Number(deductions) || 0,
        net_amount: net,
        notes: notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from("payroll_batch_items").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        if (!workerId) throw new Error("Selecione um trabalhador.");
        const { error } = await supabase.from("payroll_batch_items").insert({
          ...payload,
          batch_id: batchId,
          worker_id: workerId,
          employment_link_id: linkId || null,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batch-items", batchId] });
      toast({ title: isEdit ? "Item atualizado" : "Item adicionado" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {isEdit ? `Editar: ${(existing.workers as any)?.full_name || "Item"}` : "Novo Item"}
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}><X className="h-3 w-3" /></Button>
        </div>

        {!isEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Trabalhador *</Label>
              <Select value={workerId} onValueChange={(v) => { setWorkerId(v); setLinkId(""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(workers ?? []).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.full_name}{w.nickname ? ` (${w.nickname})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vínculo (opcional)</Label>
              <Select value={linkId || "__none__"} onValueChange={(v) => setLinkId(v === "__none__" ? "" : v)} disabled={!workerId}>
                <SelectTrigger><SelectValue placeholder="Sem vínculo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem vínculo</SelectItem>
                  {(eventLinks ?? []).map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.link_name || l.job_role || "Vínculo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Base (R$)</Label>
            <Input type="number" step="0.01" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Extras (R$)</Label>
            <Input type="number" step="0.01" value={overtimeAmount} onChange={(e) => setOvertimeAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bônus (R$)</Label>
            <Input type="number" step="0.01" value={bonuses} onChange={(e) => setBonuses(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descontos (R$)</Label>
            <Input type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">Líquido: {net.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Observações</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  );
}
