import { describe, it, expect } from "vitest";
import {
  computeFieldCompleteness,
  REQUIRED_FIELDS,
} from "@/lib/worker-completeness";

describe("worker-completeness (field layer)", () => {
  it("counts all required fields when present", () => {
    const worker: Record<string, unknown> = {};
    for (const f of REQUIRED_FIELDS) worker[f] = "x";
    const r = computeFieldCompleteness(worker);
    expect(r.missingRequired).toEqual([]);
    expect(r.requiredFilled).toBe(r.requiredTotal);
  });

  it("flags missing required fields", () => {
    const r = computeFieldCompleteness({ full_name: "Igor" });
    expect(r.missingRequired).toContain("cpf");
    expect(r.missingRequired.length).toBeGreaterThan(0);
  });

  it("does not export doc-completeness helpers (canonical RPC is the source)", async () => {
    const mod: Record<string, unknown> = await import("@/lib/worker-completeness");
    expect(mod.computeDocCompleteness).toBeUndefined();
    expect(mod.isDpReady).toBeUndefined();
  });
});