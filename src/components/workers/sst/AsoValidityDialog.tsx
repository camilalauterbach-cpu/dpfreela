// ASO validity control — corrige apenas emissão/vencimento do ASO vigente,
// sem novo upload e sem criar nova linha em worker_documents.
// Consome a RPC segura `correct_worker_document_validity`.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FolderOpen, Loader2 } from "lucide-react";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";

const RPC_MESSAGES: Record<string, string> = {
  unauthenticated: "Você precisa estar autenticado para corrigir a validade.",
  insufficient_role: "Seu perfil não permite corrigir a validade do ASO.",
  missing_required_fields: "Informe as datas de emissão e vencimento.",
  invalid_expiry: "A validade deve ser posterior à data de emissão.",
  document_not_found: "ASO não encontrado. Recarregue a página.",
  document_deleted: "Este ASO foi removido. Recarregue a página.",
  document_not_current: "Este ASO não é mais a versão vigente. Recarregue a página.",
  stale_current_document: "O ASO vigente mudou desde a última leitura. Recarregue a página.",
  unknown_document_type: "Tipo documental do ASO não foi encontrado.",
  not_aso_document: "Este documento não é um ASO.",
  invalid_storage_scope: "O ASO está com escopo de armazenamento inválido.",
};

function friendlyError(raw: string): string {
  const lower = String(raw || "").toLowerCase();
  for (const [code, msg] of Object.entries(RPC_MESSAGES)) {
    if (lower.includes(code)) return msg;
  }
  return "Não foi possível salvar a correção de validade. Tente novamente.";
}

export interface AsoValidityDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workerId: string;
  documentId: string;
  documentTypeId: string;
  documentCode: string;
  currentIssuedAt: string | null;
  currentExpiresAt: string | null;
  onManageInDocuments: () => void;
}

export function AsoValidityDialog({
  open, onOpenChange, workerId, documentId, documentTypeId, documentCode,
  currentIssuedAt, currentExpiresAt, onManageInDocuments,
}: AsoValidityDialogProps) {
  const qc = useQueryClient();
  const [issuedAt, setIssuedAt] = useState<string>(currentIssuedAt ?? "");
  const [expiresAt, setExpiresAt] = useState<string>(currentExpiresAt ?? "");
  const [reason, setReason] = useState<string>("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [isInvalidating, setIsInvalidating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIssuedAt(currentIssuedAt ?? "");
    setExpiresAt(currentExpiresAt ?? "");
    setReason("");
    setLastError(null);
  }, [open, currentIssuedAt, currentExpiresAt]);

  const today = new Date().toISOString().slice(0, 10);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!issuedAt) errs.push("Informe a data de emissão do ASO.");
    else if (issuedAt > today) errs.push("A emissão não pode ser futura.");
    if (!expiresAt) errs.push("Informe a data de vencimento do ASO.");
    if (issuedAt && expiresAt && expiresAt <= issuedAt) {
      errs.push("A validade deve ser posterior à emissão.");
    }
    return errs;
  }, [issuedAt, expiresAt, today]);

  const unchanged =
    issuedAt === (currentIssuedAt ?? "") &&
    expiresAt === (currentExpiresAt ?? "");

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "correct_worker_document_validity",
        {
          p_document_id: documentId,
          p_expected_current_id: documentId,
          p_issue_date: issuedAt,
          p_expiry_date: expiresAt,
          p_reason: reason.trim() || null,
          p_trace_id: null,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("Validade do ASO atualizada.");
      // Entra em estado de invalidação: bloqueia ações e exibe indicador de
      // carregamento enquanto refresca todos os caches dependentes.
      setIsInvalidating(true);
      try {
        // invalidateSstCaches não retorna Promise, então replicamos as query
        // keys dele explicitamente no Promise.all para garantir aguardamento.
        await Promise.all([
          invalidateComplianceCaches(qc, { workerId, eventSource: "admin_update" }),
          qc.invalidateQueries({ queryKey: ["sst-qualifications"] }),
          qc.invalidateQueries({ queryKey: ["sst-summary"] }),
          qc.invalidateQueries({ queryKey: ["sst-alert-counts"] }),
          qc.invalidateQueries({ queryKey: ["sst-worker-details"] }),
          qc.invalidateQueries({ queryKey: ["dashboard-counts"] }),
          qc.invalidateQueries({ queryKey: ["link-docs"] }),
          qc.invalidateQueries({ queryKey: ["worker-documents", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-completion", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-sst-current", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-sst-summary", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-sst-history", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-sst-links-using", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] }),
          qc.invalidateQueries({ queryKey: ["worker-qualifications", workerId] }),
          qc.invalidateQueries({ queryKey: ["sst-pendencies"] }),
          qc.invalidateQueries({ queryKey: ["worker-links", workerId] }),
          qc.invalidateQueries({ queryKey: ["employment-links", workerId] }),
        ]);
      } finally {
        setIsInvalidating(false);
      }
      onOpenChange(false);
    },
    onError: (e: any) => {
      const msg = friendlyError(String(e?.message || ""));
      setLastError(msg);
      toast.error(msg);
    },
  });

  const pending = submit.isPending || isInvalidating;
  const canSubmit = errors.length === 0 && !unchanged && !pending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!pending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md" data-testid="aso-validity-dialog">
        <DialogHeader>
          <DialogTitle>Corrigir validade do ASO — {documentCode}</DialogTitle>
          <DialogDescription>
            Ajuste apenas as datas de emissão e vencimento. O arquivo do ASO continua o
            mesmo. Para trocar ou reenviar o arquivo, use a aba Documentos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 relative">
          <div>
            <Label>Data de emissão *</Label>
            <Input
              type="date" max={today} value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              disabled={pending}
              data-testid="aso-validity-issued-at"
            />
          </div>
          <div>
            <Label>Data de vencimento *</Label>
            <Input
              type="date" min={issuedAt || undefined}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={pending}
              data-testid="aso-validity-expires-at"
            />
          </div>
          <div>
            <Label>Motivo da correção (opcional)</Label>
            <Textarea
              rows={2} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: correção de digitação, ajuste conforme documento físico."
              disabled={pending}
            />
          </div>

          {errors.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {lastError && !pending && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
              data-testid="aso-validity-error"
            >
              {lastError}
            </div>
          )}

          {isInvalidating && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md bg-background/90 backdrop-blur-sm"
              data-testid="aso-validity-invalidating-overlay"
            >
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Atualizando consultas, aguarde…
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end flex-wrap">
          <Button variant="outline" onClick={onManageInDocuments} disabled={pending}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            Gerenciar arquivo na aba Documentos
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit}
            data-testid="aso-validity-save"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isInvalidating ? "Atualizando consultas…" : "Salvar validade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}