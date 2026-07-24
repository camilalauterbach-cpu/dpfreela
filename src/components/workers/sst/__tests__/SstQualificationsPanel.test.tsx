// Q-024-D-UI-MULTIPLE — Regressão do defeito:
// O botão "Adicionar qualificação" precisa existir INDEPENDENTEMENTE de rows.length.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SstQualificationsPanel } from "../SstQualificationsPanel";

// Mocks: contexto de auth (canEdit=true) e hooks de dados.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasAnyRole: () => true }),
}));

const useWorkerSstQualificationsMock = vi.fn();
const useWorkerSstSummaryMock = vi.fn();
vi.mock("@/hooks/useWorkerSst", () => ({
  useWorkerSstQualifications: (id: string) => useWorkerSstQualificationsMock(id),
  useWorkerSstSummary: (id: string) => useWorkerSstSummaryMock(id),
}));

// Drawer é irrelevante para o teste; substituímos por stub.
vi.mock("../SstCertificateDrawer", () => ({
  SstCertificateDrawer: () => null,
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SstQualificationsPanel workerId="w-1" workerName="Trabalhador" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function summary() {
  return { data: { valid: 0, expiringSoon: 0, expired: 0, pendingDocs: 0, activeLinksUsingSst: 0 }, isLoading: false };
}

function row(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "q-" + Math.random().toString(36).slice(2, 8),
    worker_id: "w-1",
    nr_code: "NR18",
    chain_key: "NR18",
    training_type: null,
    issued_at: "2026-01-01",
    expires_at: "2027-01-01",
    workload_hours: null,
    provider_name: null,
    instructor_name: null,
    document_url: null,
    document_status: "ok",
    validity_status: "has_expiry",
    source_type: "manual",
    revision_type: "initial",
    revision_reason: null,
    document_type_id: "dt-nr18",
    employment_link_document_id: null,
    link_group_worker_id: null,
    link_group_id: null,
    event_id: null,
    company_id: null,
    notes: null,
    expiration_status: "valid",
    ...overrides,
  };
}

describe("SstQualificationsPanel — botão permanente de nova qualificação", () => {
  it("A. rows = [] — botão 'Adicionar qualificação' existe", () => {
    useWorkerSstQualificationsMock.mockReturnValue({ data: [], isLoading: false });
    useWorkerSstSummaryMock.mockReturnValue(summary());
    renderPanel();
    expect(screen.getByTestId("add-qualification-button")).toBeInTheDocument();
  });

  it("B. rows = [NR18] — botão continua existindo", () => {
    useWorkerSstQualificationsMock.mockReturnValue({
      data: [row({ nr_code: "NR18", document_type_id: "dt-nr18" })],
      isLoading: false,
    });
    useWorkerSstSummaryMock.mockReturnValue(summary());
    renderPanel();
    expect(screen.getByTestId("add-qualification-button")).toBeInTheDocument();
  });

  it("C. rows = [NR18, NR35] — botão continua existindo", () => {
    useWorkerSstQualificationsMock.mockReturnValue({
      data: [
        row({ nr_code: "NR18", document_type_id: "dt-nr18" }),
        row({ nr_code: "NR35", document_type_id: "dt-nr35" }),
      ],
      isLoading: false,
    });
    useWorkerSstSummaryMock.mockReturnValue(summary());
    renderPanel();
    expect(screen.getByTestId("add-qualification-button")).toBeInTheDocument();
  });
});