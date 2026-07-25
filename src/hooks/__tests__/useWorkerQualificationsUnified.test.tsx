// Q-024-D-UI-MULTIPLE — Testes unitários do read model unificado.
// Cobre: sourceConflict, validity_unknown (SST e worker_documents),
// integrityConflict, e ausência de contaminação entre fontes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Mocks -----------------------------------------------------------------
const sstRows = vi.fn<[], any[]>(() => []);
const docRows = vi.fn<[], any[]>(() => []);

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const state: { filters: Record<string, unknown> } = { filters: { table } };
    const chain: any = {
      select: () => chain,
      eq: (_c: string, _v: unknown) => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      then: (resolve: any) =>
        Promise.resolve(
          table === "worker_sst_qualifications_current"
            ? { data: sstRows(), error: null }
            : { data: docRows(), error: null },
        ).then(resolve),
    };
    return chain;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

vi.mock("@/hooks/useWorkerQualificationTypes", () => ({
  useWorkerQualificationTypes: () => ({
    data: [
      {
        documentTypeId: "dt-nr18",
        code: "NR18",
        normalizedCode: "NR18",
        name: "NR-18",
        category: "sst_nr",
        isActive: true,
        storageScope: "worker",
        storageFlow: "worker_sst_qualifications",
        displayOrder: 0,
        hasExpiration: true,
        defaultValidityDays: 730,
        validityMode: null,
        validityValue: null,
        validityUnit: null,
        selectable: true,
        searchText: "nr18",
      },
      {
        documentTypeId: "dt-aso",
        code: "ASO",
        normalizedCode: "ASO",
        name: "ASO",
        category: "sst_aso",
        isActive: true,
        storageScope: "worker",
        storageFlow: "worker_documents",
        displayOrder: 1,
        hasExpiration: true,
        defaultValidityDays: 365,
        validityMode: null,
        validityValue: null,
        validityUnit: null,
        selectable: true,
        searchText: "aso",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

import { useWorkerQualificationsUnified } from "../useWorkerQualificationsUnified";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  sstRows.mockReset();
  docRows.mockReset();
  sstRows.mockReturnValue([]);
  docRows.mockReturnValue([]);
});

describe("useWorkerQualificationsUnified", () => {
  it("classifica SST sem expires_at e sem validity=no_expiry como validity_unknown", async () => {
    sstRows.mockReturnValue([
      {
        id: "sst-1",
        worker_id: "w-1",
        document_type_id: "dt-nr18",
        nr_code: "NR18",
        issued_at: "2026-01-01",
        expires_at: null,
        validity_status: "unknown",
        document_status: "ok",
        document_url: "sst/w-1/NR18/x.pdf",
        expiration_status: null,
      },
    ]);
    const { result } = renderHook(() => useWorkerQualificationsUnified("w-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].status).toBe("validity_unknown");
    expect(result.current.data[0].source).toBe("sst");
    expect(result.current.data[0].sourceConflict).toBe(false);
  });

  it("classifica worker_documents sem datas como validity_unknown", async () => {
    docRows.mockReturnValue([
      {
        id: "doc-1",
        worker_id: "w-1",
        document_type_id: "dt-aso",
        status: "ok",
        file_path: "docs/w-1/aso.pdf",
        issue_date: null,
        expiry_date: null,
      },
    ]);
    const { result } = renderHook(() => useWorkerQualificationsUnified("w-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].status).toBe("validity_unknown");
    expect(result.current.data[0].source).toBe("worker_documents");
    expect(result.current.data[0].category).toBe("sst_aso");
  });

  it("sinaliza sourceConflict quando mesmo document_type_id existe em ambas as fontes", async () => {
    sstRows.mockReturnValue([
      {
        id: "sst-x",
        worker_id: "w-1",
        document_type_id: "dt-aso",
        nr_code: "ASO",
        issued_at: "2026-01-01",
        expires_at: "2027-01-01",
        validity_status: "has_expiry",
        document_status: "ok",
        document_url: "sst/w-1/aso/x.pdf",
        expiration_status: "valid",
      },
    ]);
    docRows.mockReturnValue([
      {
        id: "doc-x",
        worker_id: "w-1",
        document_type_id: "dt-aso",
        status: "ok",
        file_path: "docs/w-1/aso.pdf",
        issue_date: "2026-01-05",
        expiry_date: "2027-01-05",
      },
    ]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useWorkerQualificationsUnified("w-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
    for (const r of result.current.data) expect(r.sourceConflict).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("integrityConflict=true quando há duas linhas SST vigentes do mesmo tipo", async () => {
    sstRows.mockReturnValue([
      { id: "a", worker_id: "w-1", document_type_id: "dt-nr18", nr_code: "NR18", issued_at: "2026-01-01", expires_at: "2027-01-01", validity_status: "has_expiry", document_status: "ok", document_url: "u1", expiration_status: "valid" },
      { id: "b", worker_id: "w-1", document_type_id: "dt-nr18", nr_code: "NR18", issued_at: "2026-06-01", expires_at: "2027-06-01", validity_status: "has_expiry", document_status: "ok", document_url: "u2", expiration_status: "valid" },
    ]);
    const { result } = renderHook(() => useWorkerQualificationsUnified("w-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
    for (const r of result.current.data) expect(r.integrityConflict).toBe(true);
  });
});