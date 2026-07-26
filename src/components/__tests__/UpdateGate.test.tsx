import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UpdateGate } from "@/components/UpdateGate";
import type { Controller, VersionState } from "@/lib/version-check";

type TestCtrl = Controller & { emit: (s: VersionState) => void; updateCalls: number };

function makeCtrl(
  initial: VersionState,
  triggerImpl?: (opts?: { manualRetry?: boolean }) => Promise<
    { reloaded: true } | { reloaded: false; reason: string; message?: string }
  >,
): TestCtrl & { calls: Array<{ manualRetry?: boolean } | undefined> } {
  let state = initial;
  const listeners = new Set<(s: VersionState) => void>();
  let updateCalls = 0;
  const calls: Array<{ manualRetry?: boolean } | undefined> = [];
  const ctrl: any = {
    getState: () => state,
    subscribe(l: (s: VersionState) => void) {
      listeners.add(l);
      l(state);
      return () => listeners.delete(l);
    },
    async checkNow() {},
    async triggerUpdate(opts?: { manualRetry?: boolean }) {
      updateCalls += 1;
      calls.push(opts);
      if (triggerImpl) return triggerImpl(opts);
      return { reloaded: true } as const;
    },
    stop() {},
    markStale(remote: string) {
      state = { kind: "stale", remote };
      listeners.forEach((l) => l(state));
    },
  };
  ctrl.emit = (s: VersionState) => {
    state = s;
    listeners.forEach((l) => l(s));
  };
  Object.defineProperty(ctrl, "updateCalls", { get: () => updateCalls });
  Object.defineProperty(ctrl, "calls", { get: () => calls });
  return ctrl as TestCtrl & { calls: Array<{ manualRetry?: boolean } | undefined> };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateGate", () => {
  it("does not render dialog when versions match", () => {
    const ctrl = makeCtrl({ kind: "ok", remote: "v1" });
    render(<UpdateGate controller={ctrl} />);
    expect(screen.queryByTestId("update-gate")).toBeNull();
  });

  it("renders blocking dialog when stale and cannot be dismissed with ESC", () => {
    const ctrl = makeCtrl({ kind: "stale", remote: "v2" });
    render(<UpdateGate controller={ctrl} />);
    const dialog = screen.getByTestId("update-gate");
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("update-gate")).toBeInTheDocument();
  });

  it("auto-triggers update after 15s countdown", () => {
    const ctrl = makeCtrl({ kind: "stale", remote: "v2" });
    render(<UpdateGate controller={ctrl} />);
    expect(ctrl.updateCalls).toBe(0);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(ctrl.updateCalls).toBe(1);
  });

  it("manual click triggers update", () => {
    const ctrl = makeCtrl({ kind: "stale", remote: "v2" });
    render(<UpdateGate controller={ctrl} />);
    fireEvent.click(screen.getByTestId("update-gate-action"));
    expect(ctrl.updateCalls).toBe(1);
  });

  it("already-attempted result clears 'Atualizando…' and shows error; next click retries manually", async () => {
    let call = 0;
    const ctrl = makeCtrl({ kind: "stale", remote: "v2" }, async (opts) => {
      call += 1;
      if (call === 1) {
        return {
          reloaded: false,
          reason: "already-attempted",
          message: "guard hit",
        } as const;
      }
      // Second call: must be a manual retry.
      expect(opts?.manualRetry).toBe(true);
      return { reloaded: true } as const;
    });
    render(<UpdateGate controller={ctrl} />);

    // Auto timer fires -> already-attempted response.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    // Button is no longer stuck in "Atualizando…", error is shown.
    const btn = screen.getByTestId("update-gate-action");
    expect(btn.textContent).toContain("Atualizar agora");
    expect(screen.getByTestId("update-gate-error").textContent).toContain("guard hit");
    expect(ctrl.calls[0]).toEqual({ manualRetry: false });

    // Manual click retries with manualRetry: true.
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(ctrl.updateCalls).toBe(2);
    expect(ctrl.calls[1]).toEqual({ manualRetry: true });
  });

  it("auto timer never re-attempts the same target after first auto call", async () => {
    const ctrl = makeCtrl({ kind: "stale", remote: "v2" }, async () => ({
      reloaded: false,
      reason: "already-attempted",
      message: "x",
    }));
    render(<UpdateGate controller={ctrl} />);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(ctrl.updateCalls).toBe(1);
    // Additional time passing does not produce another auto call.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(ctrl.updateCalls).toBe(1);
  });
});