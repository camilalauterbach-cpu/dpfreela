import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";
import { isBusy, subscribe as subscribeActivity, getBusySnapshot } from "@/lib/app-activity";

// Recovery for stale Vite chunks after a redeploy.
// When the browser (or an installed PWA) still has the old index.js cached, it
// tries to fetch chunk hashes that no longer exist on the server. That breaks
// lazy routes silently — pages open blank or forms appear to "save" nothing.
// We detect the specific error and coordinate a safe reload — never yanking
// the page out from under an in-flight save or a dirty form.
const CHUNK_ERROR_FLAG = "__chunk_reload_attempted__";
function isChunkLoadError(message?: string) {
  if (!message) return false;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    /Loading (chunk|CSS chunk) [\w-]+ failed/i.test(message)
  );
}

let reloadPending = false;
let reloadToastId: string | number | null = null;
let unsubscribeActivity: (() => void) | null = null;

function humanBusyReason() {
  const s = getBusySnapshot();
  const parts: string[] = [];
  if (s.mutations > 0) parts.push(`${s.mutations} operação(ões) em andamento`);
  if (s.dirtyForms > 0) parts.push(`${s.dirtyForms} formulário(s) com alterações`);
  if (s.uploads > 0) parts.push(`${s.uploads} upload(s) ativo(s)`);
  return parts.join(" · ");
}

function doHardReload() {
  if (sessionStorage.getItem(CHUNK_ERROR_FLAG)) return;
  sessionStorage.setItem(CHUNK_ERROR_FLAG, "1");
  setTimeout(() => sessionStorage.removeItem(CHUNK_ERROR_FLAG), 10_000);
  window.location.reload();
}

function showReloadPrompt() {
  if (reloadToastId !== null) return;
  reloadToastId = toast.warning("Nova versão disponível", {
    duration: Infinity,
    description: "Recarregue para aplicar as atualizações.",
    action: {
      label: "Recarregar agora",
      onClick: () => {
        if (isBusy()) {
          // Do not yank the page while a save is in flight. Warn and keep
          // the prompt available. Reload only after a second explicit click
          // (or after activity settles + the user re-confirms).
          toast.error("Ainda há trabalho em andamento", {
            description: `${humanBusyReason()}. Finalize ou descarte antes de recarregar. Clique novamente em "Recarregar agora" para forçar.`,
          });
          return;
        }
        doHardReload();
      },
    },
    cancel: {
      label: "Depois",
      onClick: () => {
        // Just dismiss the toast — no hidden auto-reload is scheduled.
        if (reloadToastId !== null) toast.dismiss(reloadToastId);
        reloadToastId = null;
      },
    },
  });
}

function scheduleReloadWhenSafe() {
  if (reloadPending) return;
  reloadPending = true;
  if (!isBusy()) {
    showReloadPrompt();
    return;
  }
  // Wait for activity to settle, then surface the prompt. The user still has
  // to explicitly confirm the reload — nothing happens silently.
  unsubscribeActivity = subscribeActivity(() => {
    if (!isBusy()) {
      unsubscribeActivity?.();
      unsubscribeActivity = null;
      showReloadPrompt();
    }
  });
}

window.addEventListener("error", (e) => {
  if (isChunkLoadError(e?.message) || isChunkLoadError((e?.error as Error)?.message)) {
    scheduleReloadWhenSafe();
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e?.reason as Error)?.message ?? String(e?.reason ?? "");
  if (isChunkLoadError(msg)) scheduleReloadWhenSafe();
});

createRoot(document.getElementById("root")!).render(<App />);
