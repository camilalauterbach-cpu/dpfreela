// Renovação/substituição/adicional manual a partir da lista SST.
// Chama register_sst_revision com source_type='manual' — sem employment_link_document.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { invalidateSstCaches, type SstCurrentRow } from "@/hooks/useSstQualifications";

type Revision = "renewal" | "replacement" | "additional";
type Validity = "has_expiry" | "no_expiry" | "unknown";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workerId: string;
  workerName: string;
  current: SstCurrentRow;
}

export function SstRenewDialog({ open, onOpenChange, workerId, workerName, current }: Props) {
  const qc = useQueryClient();
  const [revision, setRevision] = useState<Revision>("renewal");
  const [issuedAt, setIssuedAt] = useState("");
  const [validity, setValidity] = useState<Validity>("has_expiry");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setRevision("renewal");
      setIssuedAt("");
      setValidity(current.validity_status === "no_expiry" ? "no_expiry" : "has_expiry");
      setExpiresAt("");
      setNotes("");
    }
  }, [open, current.validity_status]);

  const canSave = useMemo(() => {
    if (!issuedAt) return false;
    if (validity === "has_expiry" && !expiresAt) return false;
    if (validity === "has_expiry" && expiresAt <= issuedAt) return false;
    return true;
  }, [issuedAt, validity, expiresAt]);

  const mut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        worker_id: workerId,
        nr_code: current.nr_code,
        operation: revision,
        previous_qualification_id: revision === "additional" ? null : current.id,
        training_type: current.training_type,
        issued_at: issuedAt,
        expires_at: validity === "has_expiry" ? expiresAt : null,
        validity_status: validity,
        notes: notes.trim() || null,
        source_type: "manual",
        document_status: "no_document",
      };
      const { error } = await (supabase as any).rpc("register_sst_revision", { payload });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Revisão SST registrada.");
      invalidateSstCaches(qc);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(String(e?.message || "Falha ao registrar revisão.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar revisão — {current.nr_code}</DialogTitle>
          <DialogDescription>
            {workerName} • Anexe o comprovante depois pela aba de documentos do vínculo, se aplicável.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <RadioGroup value={revision} onValueChange={(v) => setRevision(v as Revision)}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="renewal" id="rr-renewal" />
              <Label htmlFor="rr-renewal" className="font-normal">
                <b>Renovação</b> — nova versão na mesma cadeia; anterior vira histórico.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="replacement" id="rr-replace" />
              <Label htmlFor="rr-replace" className="font-normal">
                <b>Substituição</b> — encerra a atual e cria nova; histórico preservado.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="additional" id="rr-add" />
              <Label htmlFor="rr-add" className="font-normal">
                <b>Adicional</b> — cadeia paralela; não afeta a NR ativa.
              </Label>
            </div>
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de realização *</Label>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
            <div>
              <Label>Validade</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={validity}
                onChange={(e) => setValidity(e.target.value as Validity)}
              >
                <option value="has_expiry">Possui vencimento</option>
                <option value="no_expiry">Sem vencimento</option>
                <option value="unknown">Não informada</option>
              </select>
            </div>
            {validity === "has_expiry" && (
              <div className="col-span-2">
                <Label>Data de vencimento *</Label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            )}
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={!canSave || mut.isPending}>
            {mut.isPending ? "Salvando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}