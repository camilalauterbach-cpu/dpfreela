import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVersionController,
  fetchRemoteVersion,
  performUpdate,
  RELOAD_GUARD_KEY_EXPORT,
  STORAGE_FALLBACK_KEY_EXPORT,
  type BroadcastChannelLike,
} from "@/lib/version-check";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeChannel() {
  const listeners: Array<(e: MessageEvent) => void> = [];
  const posted: unknown[] = [];
  const ch: BroadcastChannelLike = {
    postMessage: (m) => {
      posted.push(m);
    },
    addEventListener: (_t, l) => {
      listeners.push(l);
    },
    close: () => {},
  };
  return {
    ch,
    posted,
    receive: (msg: unknown) => listeners.forEach((l) => l({ data: msg } as MessageEvent)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchRemoteVersion", () => {
  it("uses no-store and an anti-cache query param", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      expect(String(url)).toMatch(/^\/version\.json\?t=/);
      expect(init?.cache).toBe("no-store");
      return jsonResponse({ version: "abc" });
    }) as unknown as typeof fetch;
    const out = await fetchRemoteVersion(fetchImpl, () => 12345);
    expect(out).toEqual({ version: "abc" });
  });
});

describe("createVersionController", () => {
  it("same version does not block", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    expect(c.getState().kind).toBe("ok");
    c.stop();
  });

  it("different version blocks with stale state", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v2" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    expect(c.getState()).toEqual({ kind: "stale", remote: "v2" });
    c.stop();
  });

  it("fetch failure yields offline, never stale", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    expect(c.getState().kind).toBe("offline");
    c.stop();
  });

  it("recovers on next check when connectivity returns", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("offline");
      return jsonResponse({ version: "v1" });
    }) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    expect(c.getState().kind).toBe("offline");
    await c.checkNow();
    expect(c.getState().kind).toBe("ok");
    c.stop();
  });

  it("BroadcastChannel message from another tab forces stale", async () => {
    const { ch, receive } = makeChannel();
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;
    const c = createVersionController({
      fetchImpl,
      localVersion: "v1",
      createChannel: () => ch,
    });
    await flush();
    expect(c.getState().kind).toBe("ok");
    receive({ type: "stale", remote: "v9" });
    expect(c.getState()).toEqual({ kind: "stale", remote: "v9" });
    c.stop();
  });

  it("stale broadcast is published to other tabs", async () => {
    const { ch, posted } = makeChannel();
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v2" })) as any;
    const c = createVersionController({
      fetchImpl,
      localVersion: "v1",
      createChannel: () => ch,
    });
    await flush();
    expect(posted).toContainEqual({ type: "stale", remote: "v2" });
    c.stop();
  });

  it("polls every 60s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    c.stop();
  });
});

describe("performUpdate — target-scoped reload guard", () => {
  function mockReload() {
    const reload = vi.fn();
    delete (globalThis as any).location;
    (globalThis as any).location = { reload };
    return reload;
  }

  it("no target -> does not reload", async () => {
    const reload = mockReload();
    const result = await performUpdate(undefined);
    expect(reload).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ reloaded: false, reason: "no-target" }));
  });

  it("same target does not reload twice; different target reloads once", async () => {
    const reload = mockReload();
    const r1 = await performUpdate("v2");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ reloaded: true });
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY_EXPORT)).toBe("v2");

    const r2 = await performUpdate("v2");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(
      expect.objectContaining({ reloaded: false, reason: "already-attempted" }),
    );

    // A different target IS allowed to reload — guard is per-version.
    const r3 = await performUpdate("v3");
    expect(reload).toHaveBeenCalledTimes(2);
    expect(r3).toEqual({ reloaded: true });
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY_EXPORT)).toBe("v3");
  });

  it("manual retry for the same target executes exactly one extra reload, no third without another click", async () => {
    const reload = mockReload();
    // First automatic attempt reloads.
    const r1 = await performUpdate("v2", { manualRetry: false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ reloaded: true });

    // Second automatic attempt for the same target is blocked.
    const r2 = await performUpdate("v2", { manualRetry: false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(
      expect.objectContaining({ reloaded: false, reason: "already-attempted" }),
    );

    // Manual retry click for the same target reloads exactly once more.
    const r3 = await performUpdate("v2", { manualRetry: true });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(r3).toEqual({ reloaded: true });

    // Without another manual click, no further automatic reload happens.
    const r4 = await performUpdate("v2", { manualRetry: false });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(r4).toEqual(
      expect.objectContaining({ reloaded: false, reason: "already-attempted" }),
    );
  });

  it("confirming remote === local clears the guard so a future new target reloads", async () => {
    const reload = mockReload();
    // Simulate a prior reload attempt for v2 in this session.
    sessionStorage.setItem(RELOAD_GUARD_KEY_EXPORT, "v2");

    // Now the app is loaded on v2 and confirms match with remote v2.
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v2" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v2" });
    await flush();
    expect(c.getState().kind).toBe("ok");
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY_EXPORT)).toBeNull();
    c.stop();

    // Later a new target v3 appears — reload is allowed.
    const r = await performUpdate("v3");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ reloaded: true });
  });
});

describe("online event triggers a real re-check", () => {
  it("dispatches window online event and observes a new fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await flush();
    const before = fetchImpl.mock.calls.length;
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
    c.stop();
  });
});

describe("storage-event fallback when BroadcastChannel is unavailable", () => {
  it("writes to a dedicated key and a peer controller reacts to storage events", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;

    // Publisher: no channel; will fall back to localStorage write.
    const publisher = createVersionController({
      fetchImpl: vi.fn(async () => jsonResponse({ version: "v2" })) as any,
      localVersion: "v1",
      createChannel: () => null,
    });
    await flush();
    const raw = localStorage.getItem(STORAGE_FALLBACK_KEY_EXPORT);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual(expect.objectContaining({ type: "stale", remote: "v2" }));

    // Subscriber: also no channel; should react to the storage event.
    const subscriber = createVersionController({
      fetchImpl,
      localVersion: "v1",
      createChannel: () => null,
    });
    await flush();
    expect(subscriber.getState().kind).toBe("ok");

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_FALLBACK_KEY_EXPORT,
        newValue: JSON.stringify({ type: "stale", remote: "v2" }),
      }),
    );
    expect(subscriber.getState()).toEqual({ kind: "stale", remote: "v2" });

    publisher.stop();
    subscriber.stop();
  });

  it("storage fallback key stays isolated; other localStorage keys are untouched", async () => {
    localStorage.setItem("user-preference", "keep-me");
    const publisher = createVersionController({
      fetchImpl: vi.fn(async () => jsonResponse({ version: "v9" })) as any,
      localVersion: "v1",
      createChannel: () => null,
    });
    await flush();
    expect(localStorage.getItem("user-preference")).toBe("keep-me");
    publisher.stop();
  });
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});