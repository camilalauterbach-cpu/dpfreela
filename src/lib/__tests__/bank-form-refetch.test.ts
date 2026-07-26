import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  BANK_SAVE_INVALIDATION_KEYS,
  invalidateWorkerAfterBankSave,
} from "@/lib/bank-form-logic";

describe("invalidateWorkerAfterBankSave", () => {
  it("invalidates the three canonical bank-related queries for the worker", async () => {
    const qc = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateWorkerAfterBankSave(qc, "worker-1");
    const calls = qc.invalidateQueries.mock.calls.map((c) => c[0].queryKey);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["worker-completion", "worker-1"],
        ["worker-documents", "worker-1"],
        ["worker-payment-methods", "worker-1"],
      ]),
    );
    expect(BANK_SAVE_INVALIDATION_KEYS).toContain("worker-completion");
  });

  it("triggers a refetch of worker-completion so status can flip without a page reload", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { status: "incomplete", missing: [{ code: "bank_document" }] }
        : { status: "complete", missing: [] };
    });

    // Prime the cache like DpReadinessBadge/WorkerCompletionChecklist would.
    const data1 = await qc.fetchQuery({
      queryKey: ["worker-completion", "w1"],
      queryFn: fetcher,
    });
    expect(data1.status).toBe("incomplete");

    // Simulate the BankDataForm onSuccess handler.
    await invalidateWorkerAfterBankSave(qc, "w1");

    // After invalidation the next observer read must go through the fetcher again.
    const data2 = await qc.fetchQuery({
      queryKey: ["worker-completion", "w1"],
      queryFn: fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data2.status).toBe("complete");
  });
});