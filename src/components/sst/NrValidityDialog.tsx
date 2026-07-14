import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { invalidateSstCaches } from "@/hooks/useSstQualifications";

export type NrDialogPhase = "ask_is_nr" | "ask_control" | "duplicity" | "form" | null;

export interface NrDialogContext {
  workerId: string;
  linkGroupWorkerId?: string;
  linkGroupId?: string;
  eventId?: string;
  companyId?: string;
  employmentLinkDocumentId: string;
  docStatus: string; // status atual do doc do vínculo
  suggestedNrCode?: string; // ex.: NR-6 quando category = nr_6
  suggestedLabel?: string;
  isOutrosCategory: boolean;
  ownerDocsQueryKey?: unknown[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPhase: Exclude<NrDialogPhase, null>;
  context: NrDialogContext;
}

type Validity = "has_expiry" | "no_expiry" | "unknown";
type Revision = "renewal" | "replacement" | "additional";

function docStatusFromLinkDoc(s: string): "pending" | "ok" | "rejected" | "no_document" {
  if (s === "approved") return "ok";
  if (s === "rejected") return "rejected";
  if (!s) return "no_document";
  return "pending";
}

export function NrValidityDialog({ open, onOpenChange, initialPhase, context }: Props) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Exclude<NrDialogPhase, null>>(initialPhase);

  // form state
  const [nrCode, setNrCode] = useState(context.suggestedNrCode || "");
  const [otherNr, setOtherNr] = useState(false);
  const [description, setDescription] = useState(context.suggestedLabel || "");
  const [issuedAt, setIssuedAt] = useState("");
  const [validity, setValidity] = useState<Validity>("unknown");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [revision, setRevision] = useState<Revision>("renewal");

  useEffect(() => {
    if (open) {
      setPhase(initialPhase);
      setNrCode(context.suggestedNrCode || "");
      setOtherNr(!context.suggestedNrCode);
      setDescription(context.suggestedLabel || "");
      setIssuedAt("");
      setValidity("unknown");
      setExpiresAt("");
      setNotes("");
      setRevision("renewal");
    }
  }, [open, initialPhase, context.suggestedNrCode, context.suggestedLabel]);

  // Verifica duplicidade quando entra na fase de form (ou antes)
  const effectiveNr = (otherNr ? nrCode : (context.suggestedNrCode || nrCode)).trim().toUpperCase();
  const dupQuery = useQuery({
    queryKey: ["sst-duplicity", context.workerId, effectiveNr],
    enabled: open && !!effectiveNr && phase === "form",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("id, nr_code, expires_at, revision_type, expiration_status")
        .eq("worker_id", context.workerId)
        .eq("nr_code", effectiveNr);
      if (error) throw error;
      return (data || []) as Array<{ id: string; nr_code: string; expires_at: string | null; revision_type: string; expiration_status: string }>;
    },
  });

  // Se houver ativas, exibir passo de duplicidade antes do form
  useEffect(() => {
    if (phase === "form" && dupQuery.data && dupQuery.data.length > 0) {
      setPhase("duplicity");
    }
  }, [phase, dupQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (revision === "replacement") {
        // Substituir preservando histórico: soft-delete o ativo principal e insere novo 'initial'
        const active = (dupQuery.data || []).filter((d) => d.revision_type !== "additional");
        for (const a of active) {
          const { error } = await (supabase as any)
            .from("worker_sst_qualifications")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", a.id);
          if (error) throw error;
        }
      }

      const payload: Record<string, unknown> = {
        worker_id: context.workerId,
        nr_code: effectiveNr,
        training_type: description.trim() || null,
        issued_at: issuedAt,
        expires_at: validity === "has_expiry" && expiresAt ? expiresAt : null,
        validity_status: validity,
        notes: notes.trim() || null,
        employment_link_document_id: context.employmentLinkDocumentId,
        link_group_worker_id: context.linkGroupWorkerId ?? null,
        link_group_id: context.linkGroupId ?? null,
        event_id: context.eventId ?? null,
        company_id: context.companyId ?? null,
        source_type: "link_document",
        revision_type:
          phase === "duplicity"
            ? revision === "additional" ? "additional"
              : revision === "replacement" ? "initial"
              : "renewal"
            : "initial",
        document_status: docStatusFromLinkDoc(context.docStatus),
      };
      const { error } = await (supabase as any)
        .from("worker_sst_qualifications")
        .insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Qualificação SST registrada.");
      invalidateSstCaches(qc);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(String(e?.message || "Falha ao salvar qualificação.")),
  });

  const canSave = useMemo(() => {
    if (!effectiveNr) return false;
    if (!issuedAt) return false;
    if (validity === "has_expiry" && !expiresAt) return false;
    if (validity === "has_expiry" && expiresAt <= issuedAt) return false;
    return true;
  }, [effectiveNr, issuedAt, validity, expiresAt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Controle de validade SST</DialogTitle>
          <DialogDescription>
            {phase === "ask_is_nr" && "Este documento é uma NR ou treinamento de SST?"}
            {phase === "ask_control" && "Deseja controlar a validade desta NR?"}
            {phase === "duplicity" && "Já existe uma NR ativa para este trabalhador com este código."}
            {phase === "form" && "Preencha os dados da qualificação."}
          </DialogDescription>
        </DialogHeader>

        {phase === "ask_is_nr" && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Não</Button>
            <Button onClick={() => setPhase("ask_control")}>Sim</Button>
          </DialogFooter>
        )}

        {phase === "ask_control" && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Agora não</Button>
            <Button onClick={() => setPhase("form")}>Sim, controlar validade</Button>
          </DialogFooter>
        )}

        {phase === "duplicity" && (
          <div className="space-y-3">
            <RadioGroup value={revision} onValueChange={(v) => setRevision(v as Revision)}>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="renewal" id="rev-renewal" />
                <Label htmlFor="rev-renewal" className="font-normal">
                  <b>Registrar renovação</b> — cria nova versão na mesma cadeia; a atual é marcada como histórica.
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="replacement" id="rev-replace" />
                <Label htmlFor="rev-replace" className="font-normal">
                  <b>Substituir documento</b> — a atual é encerrada e uma nova é criada; histórico preservado.
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="additional" id="rev-add" />
                <Label htmlFor="rev-add" className="font-normal">
                  <b>Manter como adicional</b> — cria cadeia paralela sem afetar a NR ativa.
                </Label>
              </div>
            </RadioGroup>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => setPhase("form")}>Continuar</Button>
            </DialogFooter>
          </div>
        )}

        {phase === "form" && (
          <div className="space-y-3">
            {dupQuery.isFetching && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Verificando NRs existentes…
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>NR *</Label>
                {otherNr ? (
                  <Input value={nrCode} onChange={(e) => setNrCode(e.target.value)} placeholder="Ex.: NR-33" />
                ) : (
                  <Input value={context.suggestedNrCode || nrCode} disabled />
                )}
                <button type="button" className="text-xs text-primary underline mt-1"
                  onClick={() => { setOtherNr((v) => !v); if (!otherNr) setNrCode(""); }}>
                  {otherNr ? "Usar NR sugerida" : "Outra NR"}
                </button>
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Trabalho em Altura" />
              </div>
              <div>
                <Label>Data de realização *</Label>
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </div>
              <div>
                <Label>Situação da validade</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={validity} onChange={(e) => setValidity(e.target.value as Validity)}>
                  <option value="unknown">Validade não informada</option>
                  <option value="has_expiry">Possui vencimento</option>
                  <option value="no_expiry">Não possui vencimento</option>
                </select>
              </div>
              {validity === "has_expiry" && (
                <div>
                  <Label>Data de vencimento *</Label>
                  <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
              )}
              <div className="col-span-2">
                <Label>Observações</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}