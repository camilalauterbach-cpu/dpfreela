// Q-024-D-UI-MULTIPLE — Testes unitários do painel de qualificações unificado.
// Cobre: botão permanente, KPIs (linhas unificadas), sourceConflict,
// validity_unknown e roteamento ASO (storageFlow=worker_documents).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SstQualificationsPanel } from "../SstQualificationsPanel";
import type { UnifiedQualificationRow } from "@/hooks/useWorkerQualificationsUnified";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasAnyRole: () => true }),
}));

const unifiedMock = vi.fn();
const summaryMock = vi.fn();

vi.mock("@/hooks/useWorkerQualificationsUnified", () => ({
  useWorkerQualificationsUnified: (id: string) => unifiedMock(id),
}));
vi.mock("@/hooks/useWorkerSst", () => ({
  useWorkerSstSummary: (id: string) => summaryMock(id),
}));
vi.mock("../SstCertificateDrawer", () => ({ SstCertificateDrawer: () => null }));

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

function unifiedRow(o: Partial<UnifiedQualificationRow> = {}): UnifiedQualificationRow {
  return {
    id: "row-" + Math.random().toString(36).slice(2, 8),
    workerId: "w-1",
    documentTypeId: "dt-nr18",
    code: "NR18",
    name: "NR-18 Trabalho em Altura",
    category: "sst_nr",
    storageFlow: "worker_sst_qualifications",
    source: "sst",
    issuedAt: "2026-01-01",
    expiresAt: "2027-01-01",
    validityStatus: "has_expiry",
    documentStatus: "ok",
    status: "valid",
    documentUrl: "sst/w-1/NR18/x.pdf",
    filePath: "sst/w-1/NR18/x.pdf",
    revisionType: "initial",
    isCurrent: true,
    sourceConflict: false,
    integrityConflict: false,
    ...o,
  };
}

describe("SstQualificationsPanel — botão permanente", () => {
  it("botão existe com rows vazias", () => {
    unifiedMock.mockReturnValue({ data: [], isLoading: false });
    summaryMock.mockReturnValue({ data: { valid: 0, expiringSoon: 0, expired: 0, pendingDocs: 0, activeLinksUsingSst: 0 }, isLoading: false });
    renderPanel();
    expect(screen.getByTestId("add-qualification-button")).toBeInTheDocument();
  });

  it("botão existe com múltiplas linhas", () => {
    unifiedMock.mockReturnValue({
      data: [
        unifiedRow({ code: "NR18", documentTypeId: "dt-nr18" }),
        unifiedRow({ code: "NR35", documentTypeId: "dt-nr35" }),
      ],
      isLoading: false,
    });
    summaryMock.mockReturnValue({ data: { valid: 2, expiringSoon: 0, expired: 0, pendingDocs: 0, activeLinksUsingSst: 0 }, isLoading: false });
    renderPanel();
    expect(screen.getByTestId("add-qualification-button")).toBeInTheDocument();
  });
});

describe("SstQualificationsPanel — KPIs unificados", () => {
  it("exibe os cinco KPIs a partir do summary", () => {
    unifiedMock.mockReturnValue({ data: [], isLoading: false });
    summaryMock.mockReturnValue({
      data: { valid: 7, expiringSoon: 3, expired: 2, pendingDocs: 4, activeLinksUsingSst: 5 },
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByText("Vencidas").nextSibling?.textContent).toBe("2");
    expect(screen.getByText("Vencendo").nextSibling?.textContent).toBe("3");
    expect(screen.getByText("Pendentes de documento").nextSibling?.textContent).toBe("4");
    expect(screen.getByText("Válidas").nextSibling?.textContent).toBe("7");
    expect(screen.getByText("Vínculos usando SST").nextSibling?.textContent).toBe("5");
  });
});

describe("SstQualificationsPanel — sourceConflict e validity_unknown", () => {
  it("exibe 'Conflito de fonte' quando sourceConflict=true", () => {
    unifiedMock.mockReturnValue({
      data: [unifiedRow({ sourceConflict: true, code: "ASO" })],
      isLoading: false,
    });
    summaryMock.mockReturnValue({ data: { valid: 1, expiringSoon: 0, expired: 0, pendingDocs: 0, activeLinksUsingSst: 0 }, isLoading: false });
    renderPanel();
    expect(screen.getByText(/Conflito de fonte/)).toBeInTheDocument();
  });

  it("exibe 'validade não informada' quando status=validity_unknown", () => {
    unifiedMock.mockReturnValue({
      data: [unifiedRow({
        status: "validity_unknown",
        expiresAt: null,
        validityStatus: "unknown",
      })],
      isLoading: false,
    });
    summaryMock.mockReturnValue({ data: { valid: 0, expiringSoon: 0, expired: 0, pendingDocs: 1, activeLinksUsingSst: 0 }, isLoading: false });
    renderPanel();
    expect(screen.getByText(/validade não informada/i)).toBeInTheDocument();
  });

  it("ASO (storageFlow=worker_documents) mostra 'Gerenciar na aba Documentos'", () => {
    unifiedMock.mockReturnValue({
      data: [unifiedRow({
        code: "ASO",
        category: "sst_aso",
        source: "worker_documents",
        storageFlow: "worker_documents",
        documentTypeId: "dt-aso",
      })],
      isLoading: false,
    });
    summaryMock.mockReturnValue({ data: { valid: 1, expiringSoon: 0, expired: 0, pendingDocs: 0, activeLinksUsingSst: 0 }, isLoading: false });
    renderPanel();
    expect(screen.getByTestId("manage-in-documents")).toBeInTheDocument();
  });
});