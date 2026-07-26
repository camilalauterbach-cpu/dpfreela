import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UpdateGate } from "@/components/UpdateGate";
import type { Controller, VersionState } from "@/lib/version-check";

type TestCtrl = Controller & { emit: (s: VersionState) => void; updateCalls: number };

function makeCtrl(initial: VersionState): TestCtrl {
  let state = initial;
  const listeners = new Set<(s: VersionState) => void>();
  let updateCalls = 0;
  const ctrl: any = {
    getState: () => state,
    subscribe(l: (s: VersionState) => void) {
      listeners.add(l);
      l(state);
      return () => listeners.delete(l);
    },
    async checkNow() {},
    async triggerUpdate() {
      updateCalls += 1;
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
  return ctrl as TestCtrl;
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
});