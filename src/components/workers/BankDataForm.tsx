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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ChevronDown, AlertCircle } from "lucide-react";
import { formatCpf, normalizeCpf, validateCpf } from "@/lib/validators";

// Canonical document type for the auto-generated bank data receipt.
const BANK_DOCUMENT_TYPE_ID = "f2653649-f673-40ae-b5a0-1e9e08a83e04";

type Modality = "pix" | "bank_account";

interface Props {
  workerId: string;
  workerName: string;
  workerCpf: string;
  onSuccess: () => void;
}

export function BankDataForm({ workerId, workerName, workerCpf, onSuccess }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [modality, setModality] = useState<Modality>("pix");
  const [pixKeyType, setPixKeyType] = useState<"cpf" | "phone" | "email" | "random">("cpf");
  const [pixKey, setPixKey] = useState("");
  const [bankName, setBankName] = useState("");
  const [agency, setAgency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [isSelfHolder, setIsSelfHolder] = useState(true);
  const [holderName, setHolderName] = useState(workerName);
  const [holderCpf, setHolderCpf] = useState(workerCpf);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const isDirty = !!(pixKey.trim() || accountNumber.trim() || bankName.trim());
  useUnsavedFormGuard(isDirty, `bank-data-${workerId}`);

  function collectMissing(): string[] {
    const errs: string[] = [];
    if (modality === "pix") {
      if (!pixKeyType) errs.push("Tipo de chave Pix");
      if (!pixKey.trim()) errs.push("Chave Pix");
    } else {
      if (!bankName.trim()) errs.push("Banco");
      if (!agency.trim()) errs.push("Agência");
      if (!accountNumber.trim()) errs.push("Número da conta");
      if (!accountType) errs.push("Tipo da conta");
    }
    if (!isSelfHolder) {
      if (!holderName.trim()) errs.push("Nome do titular");
      const cpfDigits = normalizeCpf(holderCpf);
      if (!cpfDigits) errs.push("CPF do titular");
      else if (!validateCpf(cpfDigits)) errs.push("CPF do titular (inválido)");
    }
    return errs;
  }

  const saveMutation = useMutationWithFeedback<void, unknown, void, unknown>({
    pendingMessage: "Salvando dados bancários…",
    successMessage: "Dados bancários salvos — comprovante gerado.",
    errorTitle: "Erro ao salvar dados bancários",
    mutationFn: async () => {
      // Normalize per-modality payload (empty strings → null, drop cross-modality fields).
      const holderCpfDigits = isSelfHolder ? normalizeCpf(workerCpf) : normalizeCpf(holderCpf);
      const payload =
        modality === "pix"
          ? {
              worker_id: workerId,
              method_type: "pix" as const,
              pix_key_type: pixKeyType,
              pix_key: pixKey.trim(),
              bank_name: bankName.trim() || null,
              agency: agency.trim() || null,
              account_number: accountNumber.trim() || null,
              account_type: null,
              holder_name: (isSelfHolder ? workerName : holderName.trim()) || null,
              holder_cpf: holderCpfDigits || null,
              is_preferred: false,
            }
          : {
              worker_id: workerId,
              method_type: "bank_account" as const,
              pix_key_type: null,
              pix_key: null,
              bank_name: bankName.trim(),
              agency: agency.trim(),
              account_number: accountNumber.trim(),
              account_type: accountType,
              holder_name: (isSelfHolder ? workerName : holderName.trim()) || null,
              holder_cpf: holderCpfDigits || null,
              is_preferred: false,
            };

      // 1. Insert payment method
      const { data: pmRow, error: pmError } = await supabase
        .from("worker_payment_methods")
        .insert(payload as any)
        .select("id")
        .single();
      if (pmError) throw pmError;
      const paymentMethodId = pmRow?.id as string | undefined;

      let uploadedPath: string | null = null;
      try {
        // 2. Generate PDF from validated per-modality data.
        const blob = generateBankReceipt({
          workerName,
          workerCpf: formatCpf(workerCpf) || workerCpf,
          bankName: payload.bank_name || undefined,
          agency: payload.agency || undefined,
          accountNumber: payload.account_number || undefined,
          accountType: payload.account_type || undefined,
          pixKeyType: payload.pix_key_type || undefined,
          pixKey: payload.pix_key || undefined,
          holderName: payload.holder_name || undefined,
          holderCpf: payload.holder_cpf ? (formatCpf(payload.holder_cpf) || payload.holder_cpf) : undefined,
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
        uploadedPath = path;

        // 4. Create worker_documents record (canonical document_type_id).
        const { error: docErr } = await supabase
          .from("worker_documents")
          .insert({
            worker_id: workerId,
            document_type: "bank_document",
            document_type_id: BANK_DOCUMENT_TYPE_ID,
            category: "bank_document",
            file_path: path,
            file_name: `comprovante_bancario_${timestamp}.pdf`,
            file_size: blob.size,
            mime_type: "application/pdf",
            status: "uploaded",
            notes: "auto_generated",
          });
        if (docErr) throw docErr;
      } catch (err) {
        // Compensate: remove storage object and payment method so nothing is orphaned.
        if (uploadedPath) {
          await supabase.storage.from("worker-documents").remove([uploadedPath]).catch(() => {});
        }
        if (paymentMethodId) {
          try {
            await supabase.from("worker_payment_methods").delete().eq("id", paymentMethodId);
          } catch {
            /* best-effort cleanup */
          }
        }
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-payment-methods", workerId] });
      onSuccess();
    },
  });

  const canSubmit = collectMissing().length === 0;
  const req = (label: string) => (
    <>
      {label} <span className="text-destructive">*</span>
    </>
  );

  return (
    <div className="space-y-4">
      {/* Modality selector */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Forma de recebimento</Label>
        <RadioGroup
          value={modality}
          onValueChange={(v) => { setModality(v as Modality); setMissing([]); }}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="pix" id="modality-pix" />
            <Label htmlFor="modality-pix" className="text-sm cursor-pointer">Pix</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="bank_account" id="modality-bank" />
            <Label htmlFor="modality-bank" className="text-sm cursor-pointer">Conta bancária</Label>
          </div>
        </RadioGroup>
      </div>

      {modality === "pix" ? (
        <div className="space-y-3">
          <div className="grid gap-3 grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{req("Tipo de chave")}</Label>
              <Select value={pixKeyType} onValueChange={(v) => setPixKeyType(v as typeof pixKeyType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpf">CPF</SelectItem>
                  <SelectItem value="phone">Telefone</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="random">Chave aleatória</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{req("Chave Pix")}</Label>
              <Input className="h-9" value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="Informe a chave" />
            </div>
          </div>

          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground h-8">
                Dados bancários complementares (opcional)
                <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Banco</Label>
                <Input className="h-9" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ex: Nubank, Bradesco, Itaú" />
              </div>
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
                  <Select value={accountType} onValueChange={(v) => setAccountType(v as typeof accountType)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">Corrente</SelectItem>
                      <SelectItem value="savings">Poupança</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{req("Banco")}</Label>
            <Input className="h-9" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ex: Nubank, Bradesco, Itaú" />
          </div>
          <div className="grid gap-3 grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{req("Agência")}</Label>
              <Input className="h-9" value={agency} onChange={(e) => setAgency(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{req("Conta")}</Label>
              <Input className="h-9" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{req("Tipo de conta")}</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as typeof accountType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

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
              <Label className="text-xs">{req("Nome do titular")}</Label>
              <Input className="h-9" value={holderName} onChange={(e) => setHolderName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{req("CPF do titular")}</Label>
              <Input className="h-9" value={holderCpf} onChange={(e) => setHolderCpf(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            Preencha antes de salvar: <strong>{missing.join(", ")}</strong>.
          </div>
        </div>
      )}

      <Button
        className="w-full"
        disabled={saveMutation.isPending}
        aria-busy={saveMutation.isPending}
        onClick={() => {
          if (saveMutation.isPending || saveMutation.isLocked()) return;
          const errs = collectMissing();
          if (errs.length) { setMissing(errs); return; }
          setMissing([]);
          saveMutation.mutate(undefined);
        }}
      >
        {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saveMutation.isPending ? "Salvando…" : "Salvar e gerar comprovante"}
      </Button>
    </div>
  );
}
