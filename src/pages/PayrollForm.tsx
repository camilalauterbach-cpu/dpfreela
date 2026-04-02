import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePayrollBatch } from "@/hooks/usePayroll";
import { useEvents } from "@/hooks/useEvents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Save } from "lucide-react";

export default function PayrollForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existing, isLoading: loadingExisting } = usePayrollBatch(id);
  const { data: events } = useEvents("", "all");

  const [batchName, setBatchName] = useState("");
  const [eventId, setEventId] = useState<string>("");
  const [referenceMonth, setReferenceMonth] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (existing) {
      setBatchName(existing.batch_name || "");
      setEventId(existing.event_id || "");
      setReferenceMonth(existing.reference_month || "");
      setNotes(existing.notes || "");
    }
  }, [existing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        batch_name: batchName.trim(),
        event_id: eventId && eventId !== "none" ? eventId : null,
        reference_month: referenceMonth || null,
        notes: notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from("payroll_batches").update(payload).eq("id", id!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("payroll_batches").insert(payload).select("id").single();
        if (error) throw error;
        return data.id;
      }
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", id] });
      toast({ title: isEdit ? "Lote atualizado" : "Lote criado" });
      navigate(`/payroll/${isEdit ? id : newId}`);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (isEdit && existing && existing.status !== "draft") {
    navigate(`/payroll/${id}`);
    return null;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/payroll")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Editar Lote" : "Novo Lote de Pagamento"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome do lote *</Label>
            <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Ex: Pagamento Rock in Rio - Abril" />
          </div>

          <div className="space-y-2">
            <Label>Evento</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger><SelectValue placeholder="Selecione um evento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {(events as any)?.data?.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mês de referência</Label>
            <Input type="month" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => mutation.mutate()} disabled={!batchName.trim() || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              {isEdit ? "Salvar" : "Criar Lote"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/payroll")}>Cancelar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
