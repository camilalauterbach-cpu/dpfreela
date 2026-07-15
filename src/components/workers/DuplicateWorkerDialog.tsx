import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export interface DuplicateMatch {
  workerId: string;
  nameMasked?: string | null;
  birthDate?: string | null;
  cpfMasked?: string | null;
  emailMasked?: string | null;
  phoneLast4?: string | null;
  similarity?: number | null;
}

export type DuplicateDialogState =
  | { kind: "existing"; workerId: string }
  | { kind: "merged"; workerId: string; mergedWorkerId: string }
  | { kind: "inactive"; workerId: string; canRestore: boolean }
  | { kind: "possible_duplicate"; matches: DuplicateMatch[] }
  | null;

interface Props {
  state: DuplicateDialogState;
  onClose: () => void;
  /** Called when the user (admin/manager) confirms "not the same person". */
  onForceCreate: () => void;
  forcePending?: boolean;
}

export function DuplicateWorkerDialog({ state, onClose, onForceCreate, forcePending }: Props) {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const canForce = hasAnyRole(["admin", "manager"]);
  const canRestore = hasAnyRole(["admin", "manager"]);

  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (state?.kind !== "inactive") { setPreview(null); return; }
    if (!canRestore) return;
    setLoadingPreview(true);
    supabase.rpc("restore_worker_preview" as any, { _worker_id: state.workerId })
      .then(({ data, error }) => {
        if (error) toast.error("Não foi possível carregar o preview.");
        else setPreview(data);
      })
      .finally(() => setLoadingPreview(false));
  }, [state, canRestore]);

  const handleRestore = async () => {
    if (state?.kind !== "inactive") return;
    setRestoring(true);
    try {
      const { data, error } = await supabase.rpc("restore_worker" as any, { _worker_id: state.workerId });
      if (error) throw error;
      toast.success("Cadastro restaurado.");
      onClose();
      navigate(`/workers/${(data as any)?.workerId ?? state.workerId}`);
    } catch (err: any) {
      const code = err?.message || "";
      const map: Record<string, string> = {
        active_cpf_conflict: "Já existe um cadastro ativo com este CPF.",
        active_linked_profile_conflict: "Perfil vinculado já está em uso por outro cadastro ativo.",
        worker_merged: "Cadastro consolidado; não pode ser restaurado.",
        worker_not_deleted: "Cadastro já está ativo.",
        invalid_cpf: "CPF do cadastro é inválido.",
        forbidden: "Somente administrador ou gestor pode restaurar.",
      };
      const friendly = Object.entries(map).find(([k]) => code.includes(k))?.[1];
      toast.error(friendly || "Não foi possível restaurar o cadastro.");
    } finally {
      setRestoring(false);
    }
  };

  const open = state !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        {state?.kind === "existing" && (
          <>
            <DialogHeader>
              <DialogTitle>CPF já cadastrado</DialogTitle>
              <DialogDescription>
                Existe um trabalhador com este CPF. Para evitar duplicidade, abra o cadastro existente em vez de criar um novo.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => { navigate(`/workers/${state.workerId}`); onClose(); }}>
                Abrir cadastro existente
              </Button>
            </DialogFooter>
          </>
        )}

        {state?.kind === "merged" && (
          <>
            <DialogHeader>
              <DialogTitle>Cadastro consolidado</DialogTitle>
              <DialogDescription>
                Este cadastro foi consolidado em outro registro. O cadastro principal será aberto.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => { navigate(`/workers/${state.workerId}`); onClose(); }}>
                Abrir cadastro principal
              </Button>
            </DialogFooter>
          </>
        )}

        {state?.kind === "inactive" && (
          <>
            <DialogHeader>
              <DialogTitle>Cadastro inativo</DialogTitle>
              <DialogDescription>
                Já existe um cadastro inativo com este CPF. Não é possível criar um novo trabalhador com o mesmo CPF.
              </DialogDescription>
            </DialogHeader>
            <div className="text-sm space-y-2">
              {loadingPreview && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados…
                </div>
              )}
              {preview?.worker && (
                <div className="rounded-md border p-3 space-y-1">
                  <div className="font-medium">{preview.worker.full_name}</div>
                  <div className="text-xs text-muted-foreground space-x-2">
                    {preview.worker.cpfMasked && <span>CPF: {preview.worker.cpfMasked}</span>}
                    {preview.worker.birth_date && <span>Nasc.: {preview.worker.birth_date}</span>}
                    {preview.worker.deleted_at && <span>Excluído: {new Date(preview.worker.deleted_at).toLocaleDateString()}</span>}
                  </div>
                  {preview.counts && (
                    <div className="text-xs text-muted-foreground pt-1">
                      Vínculos: {preview.counts.employment_links} · Docs: {preview.counts.employment_link_documents + preview.counts.worker_documents} · Pagamentos: {preview.counts.worker_payment_methods} · Dependentes: {preview.counts.worker_dependents} · SST: {preview.counts.worker_sst_qualifications}
                    </div>
                  )}
                  {preview.conflicts?.length > 0 && (
                    <div className="text-xs text-destructive pt-1">
                      Conflito ativo detectado — restauração bloqueada.
                    </div>
                  )}
                </div>
              )}
              {!canRestore && (
                <p className="text-xs text-muted-foreground">
                  Somente administrador ou gestor pode restaurar cadastros inativos.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} disabled={restoring}>Cancelar</Button>
              <Button variant="outline" onClick={() => { navigate(`/workers/${state.workerId}`); onClose(); }} disabled={restoring}>
                Abrir cadastro inativo
              </Button>
              {canRestore && state.canRestore && (
                <Button
                  onClick={handleRestore}
                  disabled={restoring || loadingPreview || preview?.result !== "ready"}
                >
                  {restoring ? "Restaurando…" : "Restaurar cadastro"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {state?.kind === "possible_duplicate" && (
          <>
            <DialogHeader>
              <DialogTitle>Possível cadastro duplicado</DialogTitle>
              <DialogDescription>
                Encontramos trabalhadores com dados parecidos. Confirme se não é a mesma pessoa antes de criar um novo cadastro.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {state.matches.map((m) => (
                <div key={m.workerId} className="rounded-md border p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.nameMasked || "(sem nome)"}</span>
                    {typeof m.similarity === "number" && (
                      <span className="text-xs text-muted-foreground">
                        similaridade {Math.round(m.similarity * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-x-2">
                    {m.birthDate && <span>Nasc.: {m.birthDate}</span>}
                    {m.cpfMasked && <span>CPF: {m.cpfMasked}</span>}
                    {m.emailMasked && <span>E-mail: {m.emailMasked}</span>}
                    {m.phoneLast4 && <span>Tel.: ****{m.phoneLast4}</span>}
                  </div>
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { navigate(`/workers/${m.workerId}`); onClose(); }}
                    >
                      Abrir este cadastro
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} disabled={forcePending}>
                Cancelar
              </Button>
              {canForce ? (
                <Button onClick={onForceCreate} disabled={forcePending}>
                  {forcePending ? "Criando…" : "Não é a mesma pessoa — criar novo"}
                </Button>
              ) : (
                <Button variant="secondary" disabled title="Somente administrador ou gestor pode confirmar">
                  Solicitar aprovação de administrador
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}