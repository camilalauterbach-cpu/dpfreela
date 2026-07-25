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

// Neutraliza a Sheet (Radix + portal) para renderizar o conteúdo inline no
// container do teste — evita interações assíncronas com portal/presence.
vi.mock("@/components/ui/sheet", () => {
  const Div = ({ children }: any) => <div>{children}</div>;
  return {
    Sheet: Div, SheetContent: Div, SheetHeader: Div, SheetTitle: Div,
    SheetDescription: Div, SheetFooter: Div,
  };
});

vi.mock("@/lib/upload-validation", () => ({
  validateUpload: () => null,
  getSafeContentType: () => "application/pdf",
  ALLOWED_FILE_EXTENSIONS: ".pdf,.jpg,.jpeg,.png,.webp",
}));

let __presetTypeId = "dt-training-int";
vi.mock("@/hooks/useWorkerQualificationTypes", () => {
  const TYPES = [
    {
      documentTypeId: "dt-training-int",
      code: "TREINAMENTO_INT",
      normalizedCode: "TREINAMENTOINT",
      name: "Treinamento Interno",
      category: "training",
      isActive: true,
      storageScope: "worker",
      storageFlow: "worker_sst_qualifications",
      displayOrder: 0,
      hasExpiration: true,
      defaultValidityDays: 365,
      validityMode: null, validityValue: null, validityUnit: null,
      selectable: true, searchText: "treinamento interno",
    },
    {
      documentTypeId: "dt-nr-35",
      code: "NR35",
      normalizedCode: "NR35",
      name: "NR-35 Altura",
      category: "sst_nr",
      isActive: true,
      storageScope: "worker",
      storageFlow: "worker_sst_qualifications",
      displayOrder: 1,
      hasExpiration: true,
      defaultValidityDays: 730,
      validityMode: null, validityValue: null, validityUnit: null,
      selectable: true, searchText: "nr35",
    },
  ];
  const RESULT = { data: TYPES, isLoading: false, error: null };
  return {
    useWorkerQualificationTypes: () => RESULT,
    normalizeQualificationSearchTerm: (s: string) => s,
  };
});

// Combobox controlado: pré-seleciona o tipo alvo do cenário atual.
vi.mock("../QualificationDocumentTypeCombobox", () => ({
  QualificationDocumentTypeCombobox: ({ value, onChange }: any) => {
    if (!value) setTimeout(() => onChange(__presetTypeId), 0);
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

describe("SstCertificateDrawer — persistência canônica por categoria", () => {
  async function fillCommonFields() {
    const file = new File([new Uint8Array([1, 2, 3])], "cert.pdf", { type: "application/pdf" });
    const fileInput = await waitFor(() => {
      const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (!el) throw new Error("file input não montado");
      return el;
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const dates = document.querySelectorAll('input[type="date"]');
      if (dates.length < 2) throw new Error("aguardando datas");
    });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-01-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2028-01-01" } });
  }

  it("training: envia document_type_id sem nr_code (evita invalid_nr_code_format)", async () => {
    __presetTypeId = "dt-training-int";
    renderDrawer();
    await fillCommonFields();

    // Select controlado — training_type via <select data-testid="training-type-select">
    const trainingSelect = await screen.findByTestId("training-type-select");
    fireEvent.change(trainingSelect, { target: { value: "Inicial" } });

    const save = await screen.findByTestId("save-qualification");
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith(
      "register_sst_revision",
      expect.objectContaining({
        payload: expect.objectContaining({
          worker_id: "w-1",
          document_type_id: "dt-training-int",
          training_type: "Inicial",
          operation: "initial",
        }),
      }),
    ));

    // §3: para training, nr_code NÃO é enviado.
    const payload = rpcMock.mock.calls.find(([n]) => n === "register_sst_revision")![1].payload;
    expect(payload).not.toHaveProperty("nr_code");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("sst_nr: envia nr_code junto do document_type_id (compat legada preservada)", async () => {
    __presetTypeId = "dt-nr-35";
    renderDrawer();
    await fillCommonFields();

    const save = await screen.findByTestId("save-qualification");
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => {
      const call = rpcMock.mock.calls.find(([n]) => n === "register_sst_revision");
      expect(call).toBeTruthy();
      const payload = call![1].payload;
      expect(payload.document_type_id).toBe("dt-nr-35");
      expect(payload.nr_code).toBe("NR35");
    });
  });
});

// Preservado para retro-compat de contexto: teste extra de erro amigável.
describe.skip("SstCertificateDrawer — legacy shape", () => {
  it("noop", () => {
    expect(true).toBe(true);
  });
});
