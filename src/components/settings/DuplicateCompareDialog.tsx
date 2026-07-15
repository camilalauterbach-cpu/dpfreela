import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ArrowLeftRight, ShieldAlert } from "lucide-react";
import { useMergePreview, useExecuteMerge, type DupWorker } from "@/hooks/useDuplicates";

interface Props {
  open: boolean;
  onClose: () => void;
  a: DupWorker;
  b: DupWorker;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = new Date(v.length <= 10 ? v + "T00:00:00" : v);
    return d.toLocaleDateString("pt-BR");
  } catch { return v; }
}

function SideCard({ w, label }: { w: DupWorker; label: string }) {
  return (
    <div className="rounded-md border p-3 space-y-1.5 text-sm bg-card">
      <div className="flex items-center justify-between">
        <Badge variant="outline">{label}</Badge>
        <span className="text-[11px] text-muted-foreground">Criado {fmtDate(w.created_at)}</span>
      </div>
      <div className="font-medium">{w.full_name}</div>
      {w.nickname && <div className="text-xs text-muted-foreground">Apelido: {w.nickname}</div>}
      <div className="text-xs text-muted-foreground">CPF: {w.cpf ?? "—"}</div>
      <div className="text-xs text-muted-foreground">Nasc.: {fmtDate(w.birth_date)}</div>
      <div className="text-xs text-muted-foreground break-all">E-mail: {w.email ?? "—"}</div>
      <div className="text-[11px] text-muted-foreground pt-1">ID: {w.id}</div>
    </div>
  );
}

export function DuplicateCompareDialog({ open, onClose, a, b }: Props) {
  // Por padrão o mais antigo é o primário — decisão manual pode inverter.
  const [primaryId, setPrimaryId] = useState<string>(() =>
    new Date(a.created_at).getTime() <= new Date(b.created_at).getTime() ? a.id : b.id
  );
  const secondaryId = primaryId === a.id ? b.id : a.id;
  const primary = primaryId === a.id ? a : b;
  const secondary = primaryId === a.id ? b : a;

  const [confirmation, setConfirmation] = useState("");
  const preview = useMergePreview(primaryId, secondaryId);
  const execMerge = useExecuteMerge();

  const canMerge =
    preview.data?.result === "ready" &&
    confirmation.trim().length > 0 &&
    !execMerge.isPending;

  async function handleMerge() {
    await execMerge.mutateAsync({ primaryId, secondaryId, confirmation });
    if (!execMerge.isError) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisão de possível duplicidade</DialogTitle>
          <DialogDescription>
            Nenhuma alteração é feita antes da confirmação. O primário é mantido; o secundário
            recebe soft-delete e passa a apontar para o primário.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <SideCard w={primary} label="Primário (mantido)" />
          <SideCard w={secondary} label="Secundário (consolidado)" />
        </div>

        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrimaryId(secondaryId)}
            disabled={execMerge.isPending}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1.5" />
            Inverter primário/secundário
          </Button>
        </div>

        <div className="rounded-md border p-3 bg-muted/30">
          <div className="text-sm font-medium mb-2">Preview do merge</div>
          {preview.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
            </div>
          )}
          {preview.isError && (
            <div className="text-sm text-destructive">
              Erro ao calcular preview: {(preview.error as Error).message}
            </div>
          )}
          {preview.data && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(preview.data.counts).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                    <span className="font-mono">{v}</span>
                  </div>
                ))}
              </div>
              {preview.data.conflicts.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  <div className="flex items-center gap-1.5 text-destructive font-medium mb-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Conflitos detectados
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {preview.data.conflicts.map((c, i) => (
                      <li key={i}><span className="font-mono">{c.code}</span> — {c.records.length} registro(s)</li>
                    ))}
                  </ul>
                  <div className="mt-1 text-muted-foreground">
                    O merge está bloqueado. Resolva os conflitos manualmente antes de continuar.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldAlert className="h-4 w-4" /> Confirmação obrigatória
          </div>
          <p className="text-xs text-muted-foreground">
            Ação irreversível. Digite <strong>CONFIRMAR</strong> ou o nome completo do primário
            (<span className="font-mono">{primary.full_name}</span>) para habilitar o merge.
          </p>
          <div className="space-y-1">
            <Label htmlFor="dup-confirm" className="text-xs">Confirmação</Label>
            <Input
              id="dup-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="CONFIRMAR"
              disabled={execMerge.isPending || preview.data?.result !== "ready"}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={execMerge.isPending}>Cancelar</Button>
          <Button variant="destructive" onClick={handleMerge} disabled={!canMerge}>
            {execMerge.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Executar merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}