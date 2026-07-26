import { useEffect, useMemo, useRef, useState } from "react";
import { createVersionController, AUTO_UPDATE_MS_EXPORT, type Controller, type VersionState } from "@/lib/version-check";

/**
 * Global blocking gate rendered above every route. When a newer version is
 * detected via /version.json, the entire app becomes non-interactive until
 * the user (or the 15s auto timer) triggers the update.
 */
export function UpdateGate({ controller }: { controller?: Controller } = {}) {
  const ctrl = useMemo<Controller>(() => controller ?? createVersionController(), [controller]);
  const [state, setState] = useState<VersionState>(ctrl.getState());
  const [countdown, setCountdown] = useState(Math.ceil(AUTO_UPDATE_MS_EXPORT / 1000));
  const [updating, setUpdating] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    const unsub = ctrl.subscribe(setState);
    return () => {
      unsub();
      if (!controller) ctrl.stop();
    };
  }, [ctrl, controller]);

  const isStale = state.kind === "stale";

  useEffect(() => {
    if (!isStale) {
      setCountdown(Math.ceil(AUTO_UPDATE_MS_EXPORT / 1000));
      return;
    }
    setCountdown(Math.ceil(AUTO_UPDATE_MS_EXPORT / 1000));
    const interval = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    const auto = setTimeout(() => {
      if (!triggered.current) {
        triggered.current = true;
        setUpdating(true);
        void ctrl.triggerUpdate();
      }
    }, AUTO_UPDATE_MS_EXPORT);
    return () => {
      clearInterval(interval);
      clearTimeout(auto);
    };
  }, [isStale, ctrl]);

  // Block ESC + prevent focus/scroll while gate is open.
  useEffect(() => {
    if (!isStale) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [isStale]);

  const offline = state.kind === "offline";

  return (
    <>
      {offline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 right-3 z-[60] rounded-md border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow"
        >
          Verificação de versão indisponível. Tentaremos novamente.
        </div>
      )}
      {isStale && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="update-gate-title"
          aria-describedby="update-gate-desc"
          data-testid="update-gate"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <div className="max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
            <h2 id="update-gate-title" className="text-lg font-semibold">
              Nova versão disponível
            </h2>
            <p id="update-gate-desc" className="mt-2 text-sm text-muted-foreground">
              O DPFreela precisa ser atualizado para manter os dados sincronizados.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Atualização automática em <span data-testid="update-gate-countdown">{countdown}</span>s
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                data-testid="update-gate-action"
                disabled={updating}
                onClick={() => {
                  if (triggered.current) return;
                  triggered.current = true;
                  setUpdating(true);
                  void ctrl.triggerUpdate();
                }}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {updating ? "Atualizando…" : "Atualizar agora"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default UpdateGate;