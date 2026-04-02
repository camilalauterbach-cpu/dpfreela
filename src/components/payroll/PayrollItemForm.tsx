import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, Loader2 } from "lucide-react";

interface Props {
  batchId: string;
  eventId: string | null;
  existing?: any;
  onClose: () => void;
}

export function PayrollItemForm({ batchId, existing, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!existing;

  const [baseAmount, setBaseAmount] = useState(existing?.base_amount?.toString() || "0");
  const [overtimeAmount, setOvertimeAmount] = useState(existing?.overtime_amount?.toString() || "0");
  const [bonuses, setBonuses] = useState(existing?.bonuses?.toString() || "0");
  const [deductions, setDeductions] = useState(existing?.deductions?.toString() || "0");
  const [notes, setNotes] = useState(existing?.notes || "");

  const net = (Number(baseAmount) || 0) + (Number(overtimeAmount) || 0) + (Number(bonuses) || 0) - (Number(deductions) || 0);

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
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batch-items", batchId] });
      toast({ title: "Item atualizado" });
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
