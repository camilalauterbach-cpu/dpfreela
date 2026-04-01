import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

interface Props {
  workerId: string;
  onClose: () => void;
}

export function PaymentMethodForm({ workerId, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [methodType, setMethodType] = useState<"bank_account" | "pix">("bank_account");
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [pixKeyType, setPixKeyType] = useState<"cpf" | "phone" | "email" | "random">("cpf");
  const [pixKey, setPixKey] = useState("");
  const [isPreferred, setIsPreferred] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        worker_id: workerId,
        method_type: methodType,
        is_preferred: isPreferred,
      };

      if (methodType === "bank_account") {
        payload.bank_name = bankName.trim() || null;
        payload.bank_code = bankCode.trim() || null;
        payload.agency = agency.trim() || null;
        payload.account_number = accountNumber.trim() || null;
        payload.account_type = accountType;
      } else {
        payload.pix_key_type = pixKeyType;
        payload.pix_key = pixKey.trim();
      }

      if (isPreferred) {
        await supabase
          .from("worker_payment_methods")
          .update({ is_preferred: false })
          .eq("worker_id", workerId)
          .is("deleted_at", null);
      }

      const { error } = await supabase.from("worker_payment_methods").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-payment-methods", workerId] });
      toast({ title: "Forma de pagamento adicionada" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (methodType === "pix" && !pixKey.trim()) {
      toast({ title: "Chave Pix é obrigatória", variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={methodType} onValueChange={(v) => setMethodType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_account">Conta bancária</SelectItem>
                <SelectItem value="pix">Pix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {methodType === "bank_account" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Banco</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1">
                <Label>Código</Label>
                <Input value={bankCode} onChange={(e) => setBankCode(e.target.value)} maxLength={10} />
              </div>
              <div className="space-y-1">
                <Label>Agência</Label>
                <Input value={agency} onChange={(e) => setAgency(e.target.value)} maxLength={20} />
              </div>
              <div className="space-y-1">
                <Label>Conta</Label>
                <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={20} />
              </div>
              <div className="space-y-1">
                <Label>Tipo de conta</Label>
                <Select value={accountType} onValueChange={(v) => setAccountType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Corrente</SelectItem>
                    <SelectItem value="savings">Poupança</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Tipo de chave</Label>
                <Select value={pixKeyType} onValueChange={(v) => setPixKeyType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="random">Aleatória</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Chave Pix</Label>
                <Input value={pixKey} onChange={(e) => setPixKey(e.target.value)} maxLength={100} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox id="preferred" checked={isPreferred} onCheckedChange={(v) => setIsPreferred(!!v)} />
            <Label htmlFor="preferred" className="text-sm cursor-pointer">Forma preferencial</Label>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Salvar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
