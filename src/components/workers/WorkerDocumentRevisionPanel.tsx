// E-DOC.2 — Painel canônico de revisão de documento worker-scoped (ex.: ASO).
// Utiliza a RPC `register_worker_document_revision`, que:
//   1. invalida a revisão vigente anterior (is_current=false);
//   2. insere a nova revisão como vigente;
//   3. registra o evento de auditoria.
// Índice único parcial garante uma única revisão vigente por
// (worker_id, document_type_id) — colisões surgem como erro 23505.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, Eye, X, RotateCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useWorkerQualificationTypes } from "@/hooks/useWorkerQualificationTypes";
import { validateUpload, getSafeContentType } from "@/lib/upload-validation";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";
import { formatSupabaseErrorForUser } from "@/lib/format-error";
import {
  clearAttempt,
  getOrCreateAttempt,
  loadAttempt,
  performIdempotentWorkerDocumentUpload,
  IdempotentUploadStageError,
  type IdempotentUploadOutcome,
} from "@/lib/worker-document-upload-attempt";
import { RevisionAuditTrail } from "@/components/workers/RevisionAuditTrail";

interface Props {
  workerId: string;
  documentTypeId: string;
  onClose?: () => void;
}

export function WorkerDocumentRevisionPanel({ workerId, documentTypeId, onClose }: Props) {
  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);

  const typesQ = useWorkerQualificationTypes({ includeInactive: true });
  const docType = useMemo(
    () => typesQ.data?.find((t) => t.documentTypeId === documentTypeId),
    [typesQ.data, documentTypeId],
  );

  const revisionsQ = useQuery({
    queryKey: ["worker-doc-revisions", workerId, documentTypeId],
    enabled: !!workerId && !!documentTypeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_documents")
        .select("*")
        .eq("worker_id", workerId)
        .eq("document_type_id", documentTypeId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const current = revisionsQ.data?.find((r: any) => r.is_current);
  const history = revisionsQ.data?.filter((r: any) => !r.is_current) ?? [];

  const [file, setFile] = useState<File | null>(null);
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [notes, setNotes] = useState("");
  // Rerender-trigger para reavaliar `loadAttempt(...)` após mudanças de sessão
  // (submit success/failure). Contador simples; não é necessário memoizar.
  const [attemptTick, setAttemptTick] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<
    | null
    | { kind: "success"; attempts: number; replay: boolean; idempotencyKey: string; idempotentHit: boolean }
    | { kind: "error"; attempts: number; replay: boolean; idempotencyKey: string | null; phase: string | null; message: string }
  >(null);

  const persistedAttempt = useMemo(() => {
    if (!file) return null;
    return loadAttempt(workerId, documentTypeId, file);
    // attemptTick force-invalidates the memo after submit finishes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, workerId, documentTypeId, attemptTick]);

  const resetForm = () => {
    if (file) clearAttempt(workerId, documentTypeId, file);
    setFile(null);
    setIssueDate("");
    setExpiryDate("");
    setDocumentNumber("");
    setIssuingAuthority("");
    setNotes("");
    setLastOutcome(null);
    setAttemptTick((v) => v + 1);
  };

  const submit = useMutation({
    mutationFn: async (): Promise<IdempotentUploadOutcome> => {
      if (!file) throw new Error("Selecione um arquivo.");
      const verr = validateUpload(file);
      if (verr) throw new Error(verr);

      const ext = file.name.split(".").pop() ?? "bin";
      // Reenvio seguro: mesma chave de idempotência e mesmo storage path
      // enquanto o attempt viver na session. Ver worker-document-upload-attempt.ts.
      const { attempt } = getOrCreateAttempt(workerId, documentTypeId, file, () =>
        `${workerId}/${documentTypeId}/${Date.now()}.${ext}`,
      );
      try {
        const outcome = await performIdempotentWorkerDocumentUpload(supabase as any, {
          workerId,
          documentTypeId,
          currentDocumentId: current?.id ?? null,
          file,
          storagePath: attempt.storagePath,
          contentType: getSafeContentType(file),
          status: "approved",
          issuedAt: issueDate || null,
          explicitExpiresAt: docType?.validityMode === "explicit_date" ? expiryDate || null : null,
          documentNumber: documentNumber || null,
          issuingAuthority: issuingAuthority || null,
          notes: notes || null,
        });
        return outcome;
      } catch (err) {
        if (err instanceof IdempotentUploadStageError) {
          const wrapped = new Error(err.message) as Error & {
            phase?: string;
            idempotencyKey?: string;
            attempts?: number;
          };
          wrapped.phase = err.phase;
          wrapped.idempotencyKey = attempt.idempotencyKey;
          wrapped.attempts = attempt.attempts;
          throw wrapped;
        }
        throw err;
      }
    },
    onSuccess: async (outcome) => {
      setLastOutcome({
        kind: "success",
        attempts: outcome.attempts,
        replay: outcome.replay,
        idempotencyKey: outcome.idempotencyKey,
        idempotentHit: !!outcome.result.idempotent_hit,
      });
      setAttemptTick((v) => v + 1);
      toast({
        title: outcome.result.idempotent_hit
          ? "Revisão já registrada (idempotente)"
          : "Revisão registrada",
        description: outcome.replay
          ? `Reenvio bem-sucedido após ${outcome.attempts} tentativa(s).`
          : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["worker-doc-revisions", workerId, documentTypeId] });
      await queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      await queryClient.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] });
      await queryClient.invalidateQueries({ queryKey: ["worker-completion", workerId] });
      invalidateComplianceCaches(queryClient, { workerId, eventSource: "upload" });
      // best-effort reevaluation with retry
      try {
        await (supabase as any).rpc("reevaluate_worker_links", { p_worker_id: workerId });
      } catch {
        // silent; UI already reflects new current revision
      }
    },
    onError: (err: any) => {
      const msg = formatSupabaseErrorForUser(err);
      const persisted = file ? loadAttempt(workerId, documentTypeId, file) : null;
      setLastOutcome({
        kind: "error",
        attempts: err?.attempts ?? persisted?.attempts ?? 1,
        replay: !!persisted,
        idempotencyKey: err?.idempotencyKey ?? persisted?.idempotencyKey ?? null,
        phase: err?.phase ?? null,
        message: msg,
      });
      setAttemptTick((v) => v + 1);
      toast({ title: "Erro ao registrar revisão", description: msg, variant: "destructive" });
    },
  });

  const openSigned = async (path: string) => {
    const { data, error } = await supabase.storage.from("worker-documents").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Falha ao gerar URL", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  if (!docType && !typesQ.isLoading) {
    return null;
  }

  return (
    <div className="space-y-3">
    <Card className="border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {docType?.name ?? "Documento"}
            {docType?.code && <Badge variant="outline" className="text-xs">{docType.code}</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Cada nova revisão substitui a versão vigente. Revisões anteriores ficam no histórico.
          </p>
        </div>
        {onClose && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current */}
        <div className="rounded-md border border-border p-3 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">Revisão vigente</div>
            {current ? (
              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                Ativo
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">Sem revisão</Badge>
            )}
          </div>
          {current ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm truncate">{current.file_name || current.file_path}</p>
                <p className="text-xs text-muted-foreground">
                  {current.issue_date ? `Emitido ${new Date(current.issue_date + "T12:00:00").toLocaleDateString("pt-BR")}` : "Sem data de emissão"}
                  {current.expiry_date ? ` · Vence ${new Date(current.expiry_date + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}
                </p>
              </div>
              {current.file_path && (
                <Button size="sm" variant="ghost" onClick={() => openSigned(current.file_path)}>
                  <Eye className="mr-1 h-3 w-3" /> Ver
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">Envie o primeiro arquivo abaixo.</p>
          )}
        </div>

        {/* Form */}
        {canEdit && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="wdrp-file" className="text-xs">Arquivo *</Label>
              <Input
                id="wdrp-file"
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wdrp-issue" className="text-xs">Emissão</Label>
                <Input id="wdrp-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="wdrp-expiry" className="text-xs">Validade</Label>
                <Input id="wdrp-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wdrp-num" className="text-xs">Número</Label>
                <Input id="wdrp-num" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="wdrp-auth" className="text-xs">Emitente</Label>
                <Input id="wdrp-auth" value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor="wdrp-notes" className="text-xs">Observações</Label>
              <Textarea id="wdrp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetForm}
                disabled={submit.isPending}
              >
                Limpar
              </Button>
              <Button
                size="sm"
                onClick={() => submit.mutate()}
                disabled={!file || submit.isPending}
              >
                {submit.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3 w-3" />
                )}
                Registrar revisão
              </Button>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Histórico ({history.length})</div>
            <div className="space-y-1">
              {history.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs py-1 border-t border-border">
                  <div className="min-w-0">
                    <p className="truncate">{r.file_name || r.file_path}</p>
                    <p className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                      {r.expiry_date ? ` · vencia em ${new Date(r.expiry_date + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}
                    </p>
                  </div>
                  {r.file_path && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openSigned(r.file_path)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
      <RevisionAuditTrail workerId={workerId} documentTypeId={documentTypeId} />
    </div>
  );
}