import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";

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