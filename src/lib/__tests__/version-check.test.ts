import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVersionController,
  fetchRemoteVersion,
  performUpdate,
  RELOAD_GUARD_KEY_EXPORT,
  type BroadcastChannelLike,
} from "@/lib/version-check";

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
    await vi.runOnlyPendingTimersAsync();
    expect(c.getState().kind).toBe("ok");
    c.stop();
  });

  it("different version blocks with stale state", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v2" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await vi.runOnlyPendingTimersAsync();
    expect(c.getState()).toEqual({ kind: "stale", remote: "v2" });
    c.stop();
  });

  it("fetch failure yields offline, never stale", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await vi.runOnlyPendingTimersAsync();
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
    await vi.runOnlyPendingTimersAsync();
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
    await vi.runOnlyPendingTimersAsync();
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
    await vi.runOnlyPendingTimersAsync();
    expect(posted).toContainEqual({ type: "stale", remote: "v2" });
    c.stop();
  });

  it("polls every 60s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "v1" })) as any;
    const c = createVersionController({ fetchImpl, localVersion: "v1" });
    await vi.runOnlyPendingTimersAsync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    c.stop();
  });
});

describe("performUpdate reload guard", () => {
  it("reloads at most once per session", async () => {
    const reload = vi.fn();
    // @ts-expect-error test override
    delete (globalThis as any).location;
    (globalThis as any).location = { reload };
    await performUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY_EXPORT)).toBe("1");
    await performUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});