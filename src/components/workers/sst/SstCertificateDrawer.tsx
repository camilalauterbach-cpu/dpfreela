// E-SST.2.C — Drawer único para envio de certificado SST.
// Modos: create | renew | replace. O fluxo é único:
//   Upload Storage → register_sst_revision → reevaluate_worker_links → invalidate.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Upload, Loader2, X } from "lucide-react";
import { invalidateSstCaches, type SstCurrentRow } from "@/hooks/useSstQualifications";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";
import {
  validateUpload, getSafeContentType, ALLOWED_FILE_EXTENSIONS,
} from "@/lib/upload-validation";
import { normalizeNr } from "@/lib/sst/nr-inference";
import { computeCertificateExpiry } from "@/lib/sst/validity";
import { useQuery } from "@tanstack/react-query";

export type SstDrawerMode = "create" | "renew" | "replace";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: SstDrawerMode;
  workerId: string;
  workerName: string;
  /** Obrigatório em renew/replace; opcional em create (row com NR conhecida) */
  current?: SstCurrentRow | null;
  /** NR pré-selecionada em create (quando disparado a partir de uma linha) */
  presetNrCode?: string | null;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

const TITLES: Record<SstDrawerMode, string> = {
  create: "Anexar certificado",
  renew: "Renovar certificado",
  replace: "Substituir certificado",
};

const DESCRIPTIONS: Record<SstDrawerMode, string> = {
  create: "Registrar um novo certificado NR para este trabalhador.",
  renew: "Nova revisão na mesma cadeia — a anterior vira histórico.",
  replace: "Encerra a atual e cria nova revisão. O histórico é preservado.",
};

export function SstCertificateDrawer({
  open, onOpenChange, mode, workerId, workerName, current, presetNrCode,
}: Props) {
  const qc = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [nrCode, setNrCode] = useState("");
  const [trainingType, setTrainingType] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [hasExpiry, setHasExpiry] = useState(true);
  // Sinaliza que o usuário editou o vencimento manualmente — evita
  // sobrescrever o valor ao recalcular a partir da NR/data de realização.
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [workload, setWorkload] = useState("");
  const [provider, setProvider] = useState("");
  const [instructor, setInstructor] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const nrLocked = mode !== "create" || !!presetNrCode;

  // Catálogo de NR/treinamento: usamos a validade padrão do document_type.
  const catalogQ = useQuery({
    queryKey: ["sst-doc-catalog"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("code, category, default_validity_days")
        .in("category", ["sst_nr", "training", "sst_aso"]);
      if (error) throw error;
      return (data ?? []) as { code: string; category: string; default_validity_days: number | null }[];
    },
  });

  const normalizedNr = normalizeNr(nrCode) || nrCode.trim().toUpperCase();
  const catalogEntry = (catalogQ.data ?? []).find((d) => d.code === normalizedNr);
  const defaultValidityDays = catalogEntry?.default_validity_days ?? null;

  useEffect(() => {
    if (!open) return;
    // Pré-carregamento por modo
    setFile(null);
    setNotes("");
    setLastError(null);
    setExpiryTouched(false);
    if (mode === "create") {
      setNrCode(presetNrCode || "");
      setTrainingType("");
      setIssuedAt("");
      setExpiresAt("");
      setHasExpiry(true);
      setWorkload("");
      setProvider("");
      setInstructor("");
    } else if (current) {
      setNrCode(current.nr_code);
      setTrainingType(current.training_type || "");
      setIssuedAt("");
      setExpiresAt("");
      setHasExpiry(current.validity_status !== "no_expiry");
      setWorkload(current.workload_hours ? String(current.workload_hours) : "");
      setProvider(current.provider_name || "");
      setInstructor(current.instructor_name || "");
    }
  }, [open, mode, current, presetNrCode]);

  // Cálculo automático do vencimento: só se o usuário não tiver editado.
  useEffect(() => {
    if (!open || !hasExpiry || expiryTouched || !issuedAt) return;
    const { expiresAt: auto } = computeCertificateExpiry({
      issuedAt,
      hasExpiry: true,
      defaultValidityDays,
    });
    if (auto) setExpiresAt(auto);
  }, [open, hasExpiry, expiryTouched, issuedAt, defaultValidityDays]);

  // Se o usuário alternar para "Sem vencimento", limpa e reseta o toque manual.
  useEffect(() => {
    if (!hasExpiry) {
      setExpiresAt("");
      setExpiryTouched(false);
    }
  }, [hasExpiry]);

  const today = new Date().toISOString().slice(0, 10);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!file) errs.push("Selecione o arquivo do certificado.");
    if (!nrCode.trim()) errs.push("Informe a NR.");
    else if (!normalizeNr(nrCode)) errs.push("Formato de NR inválido (use NRxx).");
    if (!issuedAt) errs.push("Informe a data de realização/conclusão.");
    else if (issuedAt > today) errs.push("Realização não pode ser futura.");
    if (hasExpiry) {
      if (!expiresAt) errs.push("Informe a data de validade.");
      else if (issuedAt && expiresAt <= issuedAt)
        errs.push("Validade deve ser posterior à realização.");
      else if (expiresAt <= today)
        errs.push("Validade deve ser posterior a hoje.");
    }
    return errs;
  }, [file, nrCode, issuedAt, expiresAt, hasExpiry, today]);

  const canSubmit = errors.length === 0 && !uploading;

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no_file");
      const normalized = normalizeNr(nrCode) || nrCode.trim().toUpperCase();
      const validationError = validateUpload(file);
      if (validationError) throw new Error(validationError);

      // 1) Upload
      setUploading(true);
      setLastError(null);
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      // Timestamp ISO compacto (YYYYMMDDTHHMMSSZ) — legível durante inspeções.
      const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace(/\..+$/, "").slice(0, 15) + "Z";
      const opTag =
        mode === "renew" ? "renewal" :
        mode === "replace" ? "replacement" : "initial";
      const path = `sst/${workerId}/${normalized}/${stamp}_${opTag}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, file, {
          upsert: false,
          contentType: getSafeContentType(file),
        });
      setUploading(false);
      if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

      // 2) register_sst_revision
      const operation =
        mode === "renew" ? "renewal" :
        mode === "replace" ? "replacement" :
        "initial";

      const payload: Record<string, unknown> = {
        worker_id: workerId,
        nr_code: normalized,
        operation,
        previous_qualification_id:
          (mode === "renew" || mode === "replace") ? current?.id ?? null : null,
        training_type: trainingType.trim() || null,
        issued_at: issuedAt,
        expires_at: hasExpiry ? expiresAt : null,
        validity_status: hasExpiry ? "has_expiry" : "no_expiry",
        workload_hours: workload ? Number(workload) : null,
        provider_name: provider.trim() || null,
        instructor_name: instructor.trim() || null,
        notes: notes.trim() || null,
        source_type: "manual",
        document_url: path,
        document_status: "ok",
      };
      const { error: rpcErr } = await (supabase as any).rpc(
        "register_sst_revision",
        { payload },
      );
      if (rpcErr) {
        // rollback do arquivo — evita órfão no bucket
        await supabase.storage.from("worker-documents").remove([path]).catch(() => {});
        throw new Error(String(rpcErr.message || "Falha ao registrar revisão."));
      }

      // 3) reevaluate_worker_links (retorna contagem)
      const { data: reRes } = await (supabase as any).rpc(
        "reevaluate_worker_links",
        { p_worker_id: workerId, p_event_source: "upload" },
      );
      const linksProcessed = Number((reRes as any)?.links_processed ?? 0);
      return { normalized, linksProcessed };
    },
    onSuccess: (res) => {
      // 4) Invalidação de caches — KPIs, tabela, histórico, vínculos, pendências
      invalidateSstCaches(qc);
      invalidateComplianceCaches(qc, { workerId, eventSource: "upload" });
      qc.invalidateQueries({ queryKey: ["worker-sst-current", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-summary", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-history", workerId] });
      qc.invalidateQueries({ queryKey: ["worker-sst-links-using", workerId] });

      const verb =
        mode === "renew" ? "renovada" :
        mode === "replace" ? "substituída" :
        "cadastrada";
      const linkMsg = res.linksProcessed > 0
        ? ` ${res.linksProcessed} vínculo${res.linksProcessed === 1 ? "" : "s"} reavaliado${res.linksProcessed === 1 ? "" : "s"} automaticamente.`
        : "";
      toast.success(`${res.normalized} ${verb} com sucesso.${linkMsg}`);
      onOpenChange(false);
    },
    onError: (e: any) => {
      setUploading(false);
      const msg = String(e?.message || "Falha ao registrar certificado.");
      setLastError(msg);
      toast.error(msg, {
        action: {
          label: "Tentar novamente",
          onClick: () => submit.mutate(),
        },
      });
    },
  });

  const pending = submit.isPending || uploading;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!pending) onOpenChange(v); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (pending) e.preventDefault(); }}
        onInteractOutside={(e) => { if (pending) e.preventDefault(); }}
      >
        <SheetHeader>
          <SheetTitle>{TITLES[mode]}{nrCode ? ` — ${nrCode}` : ""}</SheetTitle>
          <SheetDescription>
            {workerName} • {DESCRIPTIONS[mode]}
          </SheetDescription>
        </SheetHeader>

        {mode === "replace" && current && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">
              Substituindo
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">NR</div>
                <div className="font-medium">{current.nr_code}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Emitido em</div>
                <div className="font-medium">{fmtDate(current.issued_at)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Validade</div>
                <div className="font-medium">{fmtDate(current.expires_at)}</div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-4">
          {/* Upload */}
          <div>
            <Label>Arquivo do certificado *</Label>
            {!file ? (
              <label
                className="mt-1 flex flex-col items-center justify-center gap-1 border border-dashed rounded-md p-4 cursor-pointer hover:bg-muted/50 text-sm text-muted-foreground"
              >
                <Upload className="h-4 w-4" />
                Selecionar arquivo (PDF, JPG, PNG, WebP — máx. 10 MB)
                <input
                  type="file"
                  accept={ALLOWED_FILE_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const err = validateUpload(f);
                    if (err) { toast.error(err); return; }
                    setFile(f);
                  }}
                />
              </label>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">✔ Pronto para envio:</span>{" "}
                    {file.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setFile(null)} disabled={pending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>NR *</Label>
              <Input
                value={nrCode}
                onChange={(e) => setNrCode(e.target.value)}
                placeholder="Ex.: NR35"
                disabled={nrLocked}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Input
                value={trainingType}
                onChange={(e) => setTrainingType(e.target.value)}
                placeholder="Inicial, Reciclagem…"
              />
            </div>
            <div>
              <Label>Data de realização/conclusão *</Label>
              <Input
                type="date" max={today} value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Validade</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={hasExpiry ? "has_expiry" : "no_expiry"}
                onChange={(e) => setHasExpiry(e.target.value === "has_expiry")}
              >
                <option value="has_expiry">Possui vencimento</option>
                <option value="no_expiry">Sem vencimento</option>
              </select>
            </div>
            {hasExpiry && (
              <div className="col-span-2">
                <Label>Data de vencimento *</Label>
                <Input
                  type="date" min={issuedAt || undefined}
                  value={expiresAt}
                  onChange={(e) => {
                    setExpiresAt(e.target.value);
                    setExpiryTouched(true);
                  }}
                />
                {issuedAt && hasExpiry && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {expiryTouched ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        Data ajustada manualmente.
                      </span>
                    ) : defaultValidityDays && expiresAt ? (
                      <>
                        Vencimento calculado automaticamente:{" "}
                        <strong>{fmtDate(expiresAt)}</strong> — {defaultValidityDays} dias após a realização.
                      </>
                    ) : !defaultValidityDays ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        Esta NR não possui validade padrão configurada. Informe o vencimento manualmente.
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            )}
            <div>
              <Label>Carga horária</Label>
              <Input
                value={workload}
                inputMode="numeric"
                onChange={(e) => setWorkload(e.target.value.replace(/\D/g, ""))}
                placeholder="Horas (inteiro)"
              />
            </div>
            <div>
              <Label>Instituição</Label>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Instrutor</Label>
              <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          {lastError && !pending && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start justify-between gap-2">
              <span className="min-w-0">{lastError}</span>
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs shrink-0"
                onClick={() => submit.mutate()}
                disabled={errors.length > 0}
              >
                Tentar novamente
              </Button>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 gap-2 sm:justify-end">
          <Button
            variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!canSubmit}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {uploading ? "Enviando arquivo…" : submit.isPending ? "Registrando…" :
              mode === "renew" ? "Renovar" : mode === "replace" ? "Substituir" : "Registrar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}