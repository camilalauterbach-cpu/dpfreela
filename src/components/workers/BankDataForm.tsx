import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMutationWithFeedback } from "@/hooks/useMutationWithFeedback";
import { useUnsavedFormGuard } from "@/hooks/useUnsavedFormGuard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { generateBankReceipt } from "@/lib/generate-bank-receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, ChevronDown } from "lucide-react";
import { formatCpf } from "@/lib/validators";

interface Props {
  workerId: string;
  workerName: string;
  workerCpf: string;
  onSuccess: () => void;
}

export function BankDataForm({ workerId, workerName, workerCpf, onSuccess }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [pixKeyType, setPixKeyType] = useState("cpf");
  const [pixKey, setPixKey] = useState("");
  const [bankName, setBankName] = useState("");
  const [agency, setAgency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState("corrente");
  const [isSelfHolder, setIsSelfHolder] = useState(true);
  const [holderName, setHolderName] = useState(workerName);
  const [holderCpf, setHolderCpf] = useState(workerCpf);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isDirty = !!(pixKey.trim() || accountNumber.trim() || bankName.trim());
  useUnsavedFormGuard(isDirty, `bank-data-${workerId}`);

  const saveMutation = useMutationWithFeedback<void, unknown, void, unknown>({
    pendingMessage: "Salvando dados bancários…",
    successMessage: "Dados bancários salvos — comprovante gerado.",
    errorTitle: "Erro ao salvar dados bancários",
    mutationFn: async () => {
      // 1. Insert payment method
      const { error: pmError } = await supabase
        .from("worker_payment_methods")
        .insert({
          worker_id: workerId,
          method_type: pixKey ? "pix" : "bank_account",
          pix_key_type: pixKeyType || null,
          pix_key: pixKey || null,
          bank_name: bankName || null,
          agency: agency || null,
          account_number: accountNumber || null,
          account_type: accountType || null,
          holder_name: holderName || null,
          holder_cpf: holderCpf || null,
          is_preferred: false,
        } as any);
      if (pmError) throw pmError;

      // 2. Generate PDF
      const blob = generateBankReceipt({
        workerName,
        workerCpf: formatCpf(workerCpf) || workerCpf,
        bankName: bankName || undefined,
        agency: agency || undefined,
        accountNumber: accountNumber || undefined,
        accountType: accountType || undefined,
        pixKeyType: pixKeyType || undefined,
        pixKey: pixKey || undefined,
        holderName: holderName || undefined,
        holderCpf: holderCpf ? (formatCpf(holderCpf) || holderCpf) : undefined,
        isSelfHolder,
        generatedByUserName: user?.user_metadata?.full_name || user?.email || "Usuário do sistema",
      });

      // 3. Upload PDF
      const timestamp = Date.now();
      const path = `${workerId}/bank_document/${timestamp}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, blob, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw uploadErr;

      // 4. Create worker_documents record
      const { error: docErr } = await supabase
        .from("worker_documents")
        .insert({
          worker_id: workerId,
          document_type: "bank_document",
          category: "bank_document",
          file_path: path,
          file_name: `comprovante_bancario_${timestamp}.pdf`,
          file_size: blob.size,
          mime_type: "application/pdf",
          status: "uploaded",
          notes: "auto_generated",
        });
      if (docErr) throw docErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-payment-methods", workerId] });
      onSuccess();
    },
  });

  const canSubmit = (pixKey.trim() || accountNumber.trim()) && bankName.trim();

  return (
    <div className="space-y-4">
      {/* Pix section */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Chave Pix</h4>
        <div className="grid gap-3 grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de chave</Label>
            <Select value={pixKeyType} onValueChange={setPixKeyType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="telefone">Telefone</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="aleatoria">Chave aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Chave Pix</Label>
            <Input className="h-9" value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="Informe a chave" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Banco *</Label>
          <Input className="h-9" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ex: Nubank, Bradesco, Itaú" />
        </div>
      </div>

      {/* Collapsible bank details */}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground h-8">
            Dados bancários complementares (opcional)
            <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <div className="grid gap-3 grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Agência</Label>
              <Input className="h-9" value={agency} onChange={(e) => setAgency(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Conta</Label>
              <Input className="h-9" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de conta</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">Corrente</SelectItem>
                  <SelectItem value="poupanca">Poupança</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Holder section */}
      <div className="space-y-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="self-holder"
            checked={isSelfHolder}
            onCheckedChange={(v) => {
              const checked = !!v;
              setIsSelfHolder(checked);
              if (checked) {
                setHolderName(workerName);
                setHolderCpf(workerCpf);
              } else {
                setHolderName("");
                setHolderCpf("");
              }
            }}
          />
          <Label htmlFor="self-holder" className="text-xs">Titular é o próprio trabalhador</Label>
        </div>
        {!isSelfHolder && (
          <div className="grid gap-3 grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do titular</Label>
              <Input className="h-9" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">CPF do titular</Label>
              <Input className="h-9" value={holderCpf} onChange={(e) => setHolderCpf(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <Button
        className="w-full"
        disabled={!canSubmit || saveMutation.isPending}
        aria-busy={saveMutation.isPending}
        onClick={() => {
          if (saveMutation.isPending || saveMutation.isLocked()) return;
          saveMutation.mutate(undefined);
        }}
      >
        {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saveMutation.isPending ? "Salvando…" : "Salvar e gerar comprovante"}
      </Button>
    </div>
  );
}
