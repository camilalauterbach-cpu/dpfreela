// Q-024-D-UI-MULTIPLE — Histórico por identidade canônica (document_type_id UUID).
// O queryKey e o filtro devem usar UUID, nunca nr_code textual.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const calls: { table: string; filters: Array<[string, unknown]> } = { table: "", filters: [] };

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: unknown) => { calls.filters.push([c, v]); return chain; },
    order: () => chain,
    then: (resolve: any) => Promise.resolve({
      data: [
        { id: "r-1", nr_code: "NR18", chain_key: "NR18", revision_type: "initial", revision_reason: null, issued_at: "2026-01-01", expires_at: "2027-01-01", workload_hours: 8, provider_name: "P", instructor_name: "I", document_url: "u", document_status: "ok", validity_status: "has_expiry", source_type: "manual", notes: null, supersedes_id: null, superseded_at: null, created_at: "2026-01-01", created_by: null, document_type_id: "dt-nr18" },
      ],
      error: null,
    }).then(resolve),
  };
  return {
    supabase: {
      from: (t: string) => { calls.table = t; return chain; },
    },
  };
});

import { useSstQualificationHistory } from "../useWorkerSst";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useSstQualificationHistory — identidade canônica por UUID", () => {
  it("filtra por worker_id + document_type_id (não por nr_code)", async () => {
    calls.filters = [];
    const { result } = renderHook(
      () => useSstQualificationHistory("w-1", "dt-nr18"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls.table).toBe("worker_sst_qualifications");
    const cols = calls.filters.map(([c]) => c);
    expect(cols).toContain("worker_id");
    expect(cols).toContain("document_type_id");
    expect(cols).not.toContain("nr_code");
    const dt = calls.filters.find(([c]) => c === "document_type_id");
    expect(dt?.[1]).toBe("dt-nr18");
  });

  it("desabilitado quando documentTypeId ausente", () => {
    const { result } = renderHook(
      () => useSstQualificationHistory("w-1", undefined),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("deriva is_current a partir de superseded_at IS NULL", async () => {
    const { result } = renderHook(
      () => useSstQualificationHistory("w-1", "dt-nr18"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.[0].is_current).toBe(true);
  });
});