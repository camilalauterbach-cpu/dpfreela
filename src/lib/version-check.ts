// Mandatory client version enforcement.
//
// Contract:
//   - Poll /version.json (no-store + anti-cache query) on start, every 60s,
//     and on focus/visibilitychange(visible)/online events.
//   - When the remote version differs from the bundle's __APP_VERSION__,
//     surface a blocking gate that only allows "Update now" (auto after 15s).
//   - Cross-tab: BroadcastChannel with in-memory fallback.
//   - Network/parse failures never trigger a false divergence; they emit
//     an "offline" hint and are retried when connectivity returns.
//   - Reload guard uses sessionStorage to avoid reload loops.
//   - Never touch localStorage/IndexedDB/session/form data.

export const LOCAL_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const POLL_MS = 60_000;
const AUTO_UPDATE_MS = 15_000;
const RELOAD_GUARD_KEY = "__dpfreela_version_reloaded__";
const CHANNEL_NAME = "dpfreela-version";

export type VersionState =
  | { kind: "ok"; remote: string }
  | { kind: "stale"; remote: string }
  | { kind: "offline"; error: string }
  | { kind: "idle" };

export type Deps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  createChannel?: (name: string) => BroadcastChannelLike | null;
  localVersion?: string;
};

export interface BroadcastChannelLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  close(): void;
}

function defaultChannel(name: string): BroadcastChannelLike | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

export async function fetchRemoteVersion(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ version: string } | { error: string }> {
  try {
    const url = `/version.json?t=${now()}`;
    const res = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    if (!body || typeof body.version !== "string") {
      return { error: "invalid payload" };
    }
    return { version: body.version };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Perform the update: try SW skip-waiting + controllerchange, then reload
 * exactly once (guarded by sessionStorage). Never clears user data —
 * only Cache Storage entries related to the app.
 */
export async function performUpdate(): Promise<void> {
  try {
    // Reload-loop guard.
    if (typeof sessionStorage !== "undefined") {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") {
        // Already reloaded once in this session; do not reload again.
        return;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    }

    // Clear app-related Cache Storage buckets (never localStorage/IndexedDB).
    if (typeof caches !== "undefined" && caches?.keys) {
      try {
        const names = await caches.keys();
        await Promise.allSettled(
          names
            .filter((n) => /workbox|precache|runtime|dpfreela|assets/i.test(n))
            .map((n) => caches.delete(n)),
        );
      } catch {
        /* ignore */
      }
    }

    // Coordinate service worker update if one is registered.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          if (reg.waiting) {
            const waitForController = new Promise<void>((resolve) => {
              const t = setTimeout(resolve, 3000);
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => {
                  clearTimeout(t);
                  resolve();
                },
                { once: true },
              );
            });
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
            await waitForController;
          }
        }
      } catch {
        /* ignore */
      }
    }
  } finally {
    if (typeof location !== "undefined") {
      location.reload();
    }
  }
}

export type Controller = {
  getState: () => VersionState;
  subscribe: (listener: (state: VersionState) => void) => () => void;
  checkNow: () => Promise<void>;
  triggerUpdate: () => Promise<void>;
  stop: () => void;
  /** Force a stale state (used by BroadcastChannel receivers, and tests). */
  markStale: (remote: string) => void;
};

export function createVersionController(deps: Deps = {}): Controller {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const now = deps.now ?? Date.now;
  const createChannel = deps.createChannel ?? defaultChannel;
  const local = deps.localVersion ?? LOCAL_VERSION;

  let state: VersionState = { kind: "idle" };
  const listeners = new Set<(s: VersionState) => void>();
  const channel = createChannel(CHANNEL_NAME);
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  function emit(next: VersionState) {
    state = next;
    listeners.forEach((l) => {
      try {
        l(next);
      } catch {
        /* noop */
      }
    });
  }

  function markStale(remote: string) {
    if (state.kind === "stale") return;
    emit({ kind: "stale", remote });
    try {
      channel?.postMessage({ type: "stale", remote });
    } catch {
      /* noop */
    }
  }

  async function checkNow() {
    if (stopped) return;
    if (state.kind === "stale") return; // already blocked
    if (!fetchImpl) return;
    const result = await fetchRemoteVersion(fetchImpl, now);
    if (stopped) return;
    if ("error" in result) {
      // Failure must NOT create a false divergence.
      emit({ kind: "offline", error: result.error });
      return;
    }
    if (result.version && result.version !== local) {
      markStale(result.version);
    } else {
      emit({ kind: "ok", remote: result.version });
    }
  }

  channel?.addEventListener("message", (e) => {
    const data = (e as MessageEvent).data;
    if (data && data.type === "stale" && typeof data.remote === "string") {
      markStale(data.remote);
    }
  });

  interval = setInterval(() => {
    void checkNow();
  }, POLL_MS);

  const onFocus = () => void checkNow();
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void checkNow();
    }
  };
  const onOnline = () => void checkNow();

  if (typeof window !== "undefined") {
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  // Kick off initial check.
  void checkNow();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    checkNow,
    triggerUpdate: performUpdate,
    markStale,
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      channel?.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}

export const AUTO_UPDATE_MS_EXPORT = AUTO_UPDATE_MS;
export const POLL_MS_EXPORT = POLL_MS;
export const RELOAD_GUARD_KEY_EXPORT = RELOAD_GUARD_KEY;