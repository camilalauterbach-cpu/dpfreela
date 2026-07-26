// Q-026 — Correção de cargo/alocação deve invalidar imediatamente a matriz
// de qualificações e a resolução de contexto operacional, para que "Contexto
// pendente" desapareça sem exigir reload.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
  },
}));

vi.mock("@/lib/compliance-cache", () => ({
  invalidateComplianceCaches: vi.fn(),
}));

import { useUpdateGroupWorker } from "@/hooks/useLinkGroups";

describe("useUpdateGroupWorker — matrix invalidation", () => {
  it("invalida worker-qualifications e worker-operational-contexts após salvar", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUpdateGroupWorker(), { wrapper });

    await result.current.mutateAsync({
      id: "alloc-1",
      link_group_id: "grp-1",
      worker_id: "worker-1",
      job_role_id: "role-1",
    } as any);

    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as any).queryKey?.[0]);
      expect(keys).toEqual(
        expect.arrayContaining([
          "worker-qualifications",
          "worker-qualifications-unified-docs",
          "worker-operational-contexts",
        ]),
      );
    });
  });
});