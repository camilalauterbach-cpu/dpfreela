import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { fetchAllQualificationRows } from "@/lib/qualifications-export";

function makeRow(i: number) {
  return {
    worker_id: `w${i}`,
    worker_name: `Worker ${i}`,
    cells: [],
    counters: { expired: 0, warning: 0, missing: 0, ok: 0 },
  };
}

function makePage(items: ReturnType<typeof makeRow>[], extras: Record<string, unknown>) {
  return {
    schema_version: 1,
    generated_at: "2026-01-01",
    columns: [],
    items,
    warning_days: 30,
    ...extras,
  };
}

beforeEach(() => rpcMock.mockReset());

describe("fetchAllQualificationRows pagination", () => {
  it("continua paginando quando a RPC retorna apenas total_workers", async () => {
    const first = Array.from({ length: 500 }, (_, i) => makeRow(i));
    const second = [makeRow(500)];
    rpcMock
      .mockResolvedValueOnce({ data: makePage(first, { total_workers: 501 }), error: null })
      .mockResolvedValueOnce({ data: makePage(second, { total_workers: 501 }), error: null });

    const result = await fetchAllQualificationRows({
      search: "", state: null, onlyActiveContexts: false, documentTypeIds: ["dt1"],
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_offset: 0, p_limit: 500 });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_offset: 500 });
    expect(result.items).toHaveLength(501);
    expect(result.total).toBe(501);
  });

  it("interrompe quando a RPC repete a mesma página", async () => {
    const items = Array.from({ length: 500 }, (_, i) => makeRow(i));
    rpcMock.mockResolvedValue({ data: makePage(items, {}), error: null });

    await expect(
      fetchAllQualificationRows({
        search: "", state: null, onlyActiveContexts: false, documentTypeIds: ["dt1"],
      }),
    ).rejects.toThrow(/não avançou/);
  });
});