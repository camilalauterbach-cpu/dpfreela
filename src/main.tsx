import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Recovery for stale Vite chunks after a redeploy.
// When the browser (or an installed PWA) still has the old index.js cached, it
// tries to fetch chunk hashes that no longer exist on the server. That breaks
// lazy routes silently — pages open blank or forms appear to "save" nothing.
// We detect the specific error and force a single hard reload to pick up the
// new bundle. A sessionStorage flag prevents reload loops.
const CHUNK_ERROR_FLAG = "__chunk_reload_attempted__";
function isChunkLoadError(message?: string) {
  if (!message) return false;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    /Loading (chunk|CSS chunk) [\w-]+ failed/i.test(message)
  );
}
function attemptChunkReload() {
  if (sessionStorage.getItem(CHUNK_ERROR_FLAG)) return;
  sessionStorage.setItem(CHUNK_ERROR_FLAG, "1");
  // Clear the flag after a short window so a real bug doesn't get muted forever.
  setTimeout(() => sessionStorage.removeItem(CHUNK_ERROR_FLAG), 10_000);
  window.location.reload();
}
window.addEventListener("error", (e) => {
  if (isChunkLoadError(e?.message) || isChunkLoadError((e?.error as Error)?.message)) {
    attemptChunkReload();
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e?.reason as Error)?.message ?? String(e?.reason ?? "");
  if (isChunkLoadError(msg)) attemptChunkReload();
});

createRoot(document.getElementById("root")!).render(<App />);
