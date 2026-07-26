// Mandatory client version enforcement.
//
// Contract:
//   - Poll /version.json (no-store + anti-cache query) on start, every 60s,
//     and on focus/visibilitychange(visible)/online events.
//   - When the remote version differs from the bundle's __APP_VERSION__,
//     surface a blocking gate that only allows "Update now" (auto after 15s).
//   - Cross-tab: BroadcastChannel with a real `storage`-event fallback keyed
//     on a dedicated key. Never clears any other storage.
//   - Network/parse failures never trigger a false divergence; they emit
//     an "offline" hint and are retried when connectivity returns.
//   - Reload guard is bound to the target remote version (not a global
//     boolean): a given target reloads at most once, but a later new target
//     in the same session may still reload once.
//   - The storage fallback writes ONLY to a single dedicated key
//     (STORAGE_FALLBACK_KEY). It never clears localStorage and never touches
//     any other user keys, IndexedDB, session storage or form data.

export const LOCAL_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const POLL_MS = 60_000;
const AUTO_UPDATE_MS = 15_000;
const RELOAD_GUARD_KEY = "__dpfreela_reload_for_version__";
const CHANNEL_NAME = "dpfreela-version";
const STORAGE_FALLBACK_KEY = "__dpfreela_version_broadcast__";

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
 * Perform the update for a specific target version.
 *
 * Reload guard is scoped to `targetVersion`: if this session already reloaded
 * for that exact version and the app still sees the old bundle, we do NOT
 * reload again automatically — we surface a failure the caller can show as
 * a retry state. A later, different target version can still reload once.
 *
 * Never touches localStorage / IndexedDB / user data — only Cache Storage
 * buckets that look app/asset related.
 */
export type UpdateResult =
  | { reloaded: true }
  | { reloaded: false; reason: "already-attempted" | "no-target" | "error"; message?: string };

export type PerformUpdateOptions = {
  /**
   * When true, this is an explicit user-initiated retry. The reload guard for
   * this exact target version is removed before proceeding, allowing exactly
   * one additional reload attempt. Automatic timers must NEVER pass this.
   */
  manualRetry?: boolean;
};

export async function performUpdate(
  targetVersion?: string,
  options: PerformUpdateOptions = {},
): Promise<UpdateResult> {
  if (!targetVersion) {
    return { reloaded: false, reason: "no-target", message: "Sem versão de destino." };
  }
  // Reload guard scoped to the target version.
  if (typeof sessionStorage !== "undefined") {
    const alreadyAttempted = sessionStorage.getItem(RELOAD_GUARD_KEY) === targetVersion;
    if (alreadyAttempted && !options.manualRetry) {
      return {
        reloaded: false,
        reason: "already-attempted",
        message:
          "Já tentamos atualizar para esta versão nesta sessão. Verifique sua conexão e tente novamente.",
      };
    }
    // Manual retry: replace the guard entry so this attempt is treated as a
    // fresh single-shot attempt for the same target version.
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* noop */
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, targetVersion);
  }
  try {
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
  } catch (err) {
    return {
      reloaded: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
    if (typeof location !== "undefined") {
      location.reload();
    }
  return { reloaded: true };
}

export type Controller = {
  getState: () => VersionState;
  subscribe: (listener: (state: VersionState) => void) => () => void;
  checkNow: () => Promise<void>;
  triggerUpdate: (options?: PerformUpdateOptions) => Promise<UpdateResult>;
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
  const hasChannel = !!channel;

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
    // Storage fallback for browsers/contexts without BroadcastChannel.
    if (!hasChannel && typeof localStorage !== "undefined") {
      try {
        // Dedicated key only. This write does NOT clear localStorage and does
        // NOT alter any other keys — every other user preference/session
        // entry is preserved exactly as-is.
        localStorage.setItem(
          STORAGE_FALLBACK_KEY,
          JSON.stringify({ type: "stale", remote, ts: now() }),
        );
      } catch {
        /* noop */
      }
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
      // Confirmed running the current version — clear any prior reload
      // guard so a future new target in this same session can reload once.
      if (
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(RELOAD_GUARD_KEY)
      ) {
        try {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch {
          /* noop */
        }
      }
      emit({ kind: "ok", remote: result.version });
    }
  }

  channel?.addEventListener("message", (e) => {
    const data = (e as MessageEvent).data;
    if (data && data.type === "stale" && typeof data.remote === "string") {
      markStale(data.remote);
    }
  });

  // storage-event fallback (only when there is no BroadcastChannel).
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_FALLBACK_KEY || !e.newValue) return;
    try {
      const data = JSON.parse(e.newValue);
      if (data && data.type === "stale" && typeof data.remote === "string") {
        markStale(data.remote);
      }
    } catch {
      /* noop */
    }
  };
  if (!hasChannel && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

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
    triggerUpdate: async (options: PerformUpdateOptions = {}) => {
      const target = state.kind === "stale" ? state.remote : undefined;
      return performUpdate(target, options);
    },
    markStale,
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      channel?.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
        if (!hasChannel) window.removeEventListener("storage", onStorage);
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
export const STORAGE_FALLBACK_KEY_EXPORT = STORAGE_FALLBACK_KEY;