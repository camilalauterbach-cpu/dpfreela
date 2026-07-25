// Q-024-D-UI-MULTIPLE — Mutation do drawer.
// Cobre a persistência de um treinamento (training) via register_sst_revision,
// com identidade canônica document_type_id (UUID) — nr_code apenas como rótulo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks -----------------------------------------------------------------
const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => rpcMock(name, args),
    storage: {
      from: () => ({
        upload: (p: string, f: File, o: any) => uploadMock(p, f, o),
        remove: (paths: string[]) => removeMock(paths),
      }),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/compliance-cache", () => ({ invalidateComplianceCaches: vi.fn() }));
vi.mock("@/hooks/useSstQualifications", () => ({ invalidateSstCaches: vi.fn() }));

vi.mock("@/lib/upload-validation", () => ({
  validateUpload: () => null,
  getSafeContentType: () => "application/pdf",
  ALLOWED_FILE_EXTENSIONS: ".pdf,.jpg,.jpeg,.png,.webp",
}));

vi.mock("@/hooks/useWorkerQualificationTypes", () => ({
  useWorkerQualificationTypes: () => ({
    data: [
      {
        documentTypeId: "dt-training-nr35",
        code: "NR35",
        normalizedCode: "NR35",
        name: "NR-35 Altura",
        category: "training",
        isActive: true,
        storageScope: "worker",
        storageFlow: "worker_sst_qualifications",
        displayOrder: 0,
        hasExpiration: true,
        defaultValidityDays: 730,
        validityMode: null, validityValue: null, validityUnit: null,
        selectable: true, searchText: "nr35",
      },
    ],
    isLoading: false,
    error: null,
  }),
  normalizeQualificationSearchTerm: (s: string) => s,
}));

// Combobox: renderiza controlado, pré-seleciona o único tipo disponível.
vi.mock("../QualificationDocumentTypeCombobox", () => ({
  QualificationDocumentTypeCombobox: ({ value, onChange }: any) => {
    if (!value) {
      // dispara seleção automática do único item para simplificar o teste
      setTimeout(() => onChange("dt-training-nr35"), 0);
    }
    return null;
  },
}));

import { SstCertificateDrawer } from "../SstCertificateDrawer";

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SstCertificateDrawer
        open
        onOpenChange={() => {}}
        mode="create"
        workerId="w-1"
        workerName="João"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "register_sst_revision") return { data: null, error: null };
    if (name === "reevaluate_worker_links") return { data: { links_processed: 0 }, error: null };
    return { data: null, error: null };
  });
});

describe("SstCertificateDrawer — persistência de treinamento com identidade canônica", () => {
  it("submete document_type_id (UUID) + training_type + workload em register_sst_revision", async () => {
    renderDrawer();

    // Anexa arquivo
    const file = new File([new Uint8Array([1, 2, 3])], "cert.pdf", { type: "application/pdf" });
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });

    // Datas: realização e vencimento futuros
    const dateInputs = document.querySelectorAll('input[type="date"]');
    // dateInputs[0] = realização, dateInputs[1] = vencimento
    const past = "2026-01-01";
    const future = "2028-01-01";
    fireEvent.change(dateInputs[0], { target: { value: past } });
    fireEvent.change(dateInputs[1], { target: { value: future } });

    // Preenche treinamento (usa placeholders/atributos porque os shadcn Labels
    // não têm htmlFor associado ao input).
    fireEvent.change(
      screen.getByPlaceholderText("Inicial, Reciclagem…"),
      { target: { value: "Reciclagem" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Horas (inteiro)"),
      { target: { value: "8" } },
    );
    const allInputs = document.querySelectorAll("input");
    const provider = Array.from(allInputs).find((el) =>
      el.previousElementSibling?.textContent === "Instituição",
    ) as HTMLInputElement | undefined;
    const instructor = Array.from(allInputs).find((el) =>
      el.previousElementSibling?.textContent === "Instrutor",
    ) as HTMLInputElement | undefined;
    if (provider) fireEvent.change(provider, { target: { value: "SESI" } });
    if (instructor) fireEvent.change(instructor, { target: { value: "Prof. X" } });

    // Submete
    const save = await screen.findByTestId("save-qualification");
    await waitFor(() => {
      if ((save as HTMLButtonElement).disabled) {
        const list = document.querySelectorAll("ul li");
        const errs = Array.from(list).map((l) => l.textContent).join("\n");
        throw new Error("Save still disabled. Errors:\n" + errs);
      }
    }, { timeout: 2000 });
    fireEvent.click(save);

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "register_sst_revision",
        expect.objectContaining({
          payload: expect.objectContaining({
            worker_id: "w-1",
            document_type_id: "dt-training-nr35",
            nr_code: "NR35",
            training_type: "Reciclagem",
            workload_hours: 8,
            provider_name: "SESI",
            instructor_name: "Prof. X",
            issued_at: past,
            expires_at: future,
            validity_status: "has_expiry",
            operation: "initial",
            source_type: "manual",
            document_status: "ok",
          }),
        }),
      ),
    );

    // Storage foi acionado antes da RPC — sem rollback (upload OK, RPC OK).
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(removeMock).not.toHaveBeenCalled();

    // Reavaliação foi disparada.
    expect(rpcMock).toHaveBeenCalledWith(
      "reevaluate_worker_links",
      expect.objectContaining({ p_worker_id: "w-1", p_event_source: "upload" }),
    );
  });
});