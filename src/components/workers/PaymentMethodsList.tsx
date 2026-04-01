import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkerPaymentMethods } from "@/hooks/useWorkers";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, Trash2, Loader2 } from "lucide-react";
import { PaymentMethodForm } from "./PaymentMethodForm";

interface Props {
  workerId: string;
}

export function PaymentMethodsList({ workerId }: Props) {
  const { data: methods, isLoading } = useWorkerPaymentMethods(workerId);
  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const [showForm, setShowForm] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("worker_payment_methods")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-payment-methods", workerId] });
      toast({ title: "Forma de pagamento removida" });
    },
  });

  const setPreferredMutation = useMutation({
    mutationFn: async (id: string) => {
      // First unset all preferred for this worker
      await supabase
        .from("worker_payment_methods")
        .update({ is_preferred: false })
        .eq("worker_id", workerId)
        .is("deleted_at", null);
      // Then set the selected one
      const { error } = await supabase
        .from("worker_payment_methods")
        .update({ is_preferred: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-payment-methods", workerId] });
      toast({ title: "Forma preferencial atualizada" });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Formas de recebimento</h3>
        {canEdit && !showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3 w-3" /> Adicionar
          </Button>
        )}
      </div>

      {showForm && (
        <PaymentMethodForm
          workerId={workerId}
          onClose={() => setShowForm(false)}
        />
      )}

      {!methods?.length && !showForm ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma forma de recebimento cadastrada.
          </CardContent>
        </Card>
      ) : (
        methods?.map((m) => (
          <Card key={m.id}>
            <CardContent className="flex items-start justify-between gap-2 py-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {m.method_type === "bank_account" ? "Conta bancária" : "Pix"}
                  </span>
                  {m.is_preferred && <Badge variant="secondary" className="text-xs">Preferencial</Badge>}
                </div>
                {m.method_type === "bank_account" ? (
                  <p className="text-sm text-muted-foreground">
                    {m.bank_name} • Ag {m.agency} • {m.account_type === "savings" ? "Poupança" : "CC"} {m.account_number}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {m.pix_key_type?.toUpperCase()}: {m.pix_key}
                  </p>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  {!m.is_preferred && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPreferredMutation.mutate(m.id)} title="Definir como preferencial">
                      <Star className="h-3 w-3" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(m.id)} title="Remover">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
