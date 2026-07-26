// Q-PREFLIGHT — Preflight autoritativo antes do upload.
// Cobre: create sem vigente → initial; create com vigente no preflight → renewal
// automático com previous/expected id; mesmo período → bloqueia antes do Storage;
// conflito de corrida na RPC → rollback do arquivo e CTA correto preservando campos.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const preflightMaybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => rpcMock(name, args),
    from: (_tbl: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => preflightMaybeSingle() }),
        }),
      }),
    }),
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

vi.mock("@/hooks/useWorkerQualificationTypes", () => {
  const TYPES = [{
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
  }];
  return {
    useWorkerQualificationTypes: () => ({ data: TYPES, isLoading: false, error: null }),
    normalizeQualificationSearchTerm: (s: string) => s,
  };
});

vi.mock("../QualificationDocumentTypeCombobox", () => ({
  QualificationDocumentTypeCombobox: ({ value, onChange }: any) => {
    if (!value) setTimeout(() => onChange("dt-nr-35"), 0);
    return null;
  },
}));

import { SstCertificateDrawer } from "../SstCertificateDrawer";

function renderDrawer(overrides: Partial<React.ComponentProps<typeof SstCertificateDrawer>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SstCertificateDrawer
        open
        onOpenChange={() => {}}
        mode="create"
        workerId="w-1"
        workerName="João"
        {...(overrides as any)}
      />
    </QueryClientProvider>,
  );
}

async function fillCommonFields(dates: { issued: string; expires: string } = {
  issued: "2025-02-01", expires: "2027-02-01",
}) {
  const file = new File([new Uint8Array([1, 2, 3])], "cert.pdf", { type: "application/pdf" });
  const fileInput = await waitFor(() => {
    const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!el) throw new Error("file input não montado");
    return el;
  });
  fireEvent.change(fileInput, { target: { files: [file] } });
  await waitFor(() => {
    const inputs = document.querySelectorAll('input[type="date"]');
    if (inputs.length < 2) throw new Error("aguardando datas");
  });
  const dateInputs = document.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: dates.issued } });
  fireEvent.change(dateInputs[1], { target: { value: dates.expires } });
}

beforeEach(() => {
  rpcMock.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
  preflightMaybeSingle.mockReset();
  uploadMock.mockResolvedValue({ error: null });
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "register_sst_revision") return { data: null, error: null };
    if (name === "reevaluate_worker_links") return { data: { links_processed: 0 }, error: null };
    return { data: null, error: null };
  });
});

describe("SstCertificateDrawer — preflight autoritativo", () => {
  it("sem vigente → operation=initial e previous_id=null", async () => {
    preflightMaybeSingle.mockResolvedValue({ data: null, error: null });
    renderDrawer();
    await fillCommonFields();
    fireEvent.click(await screen.findByTestId("save-qualification"));

    await waitFor(() => {
      const call = rpcMock.mock.calls.find(([n]) => n === "register_sst_revision");
      expect(call).toBeTruthy();
      const p = call![1].payload;
      expect(p.operation).toBe("initial");
      expect(p.previous_qualification_id).toBeNull();
      expect(p.expected_current_qualification_id).toBeNull();
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("props vazias + preflight retorna vigente com período diferente → converte em renewal", async () => {
    preflightMaybeSingle.mockResolvedValue({
      data: {
        id: "q-current",
        worker_id: "w-1",
        document_type_id: "dt-nr-35",
        issued_at: "2023-01-01",
        expires_at: "2025-01-01",
      },
      error: null,
    });
    renderDrawer(); // sem currentRows/currentByDocumentTypeId
    await fillCommonFields();
    fireEvent.click(await screen.findByTestId("save-qualification"));

    await waitFor(() => {
      const call = rpcMock.mock.calls.find(([n]) => n === "register_sst_revision");
      expect(call).toBeTruthy();
      const p = call![1].payload;
      expect(p.operation).toBe("renewal");
      expect(p.previous_qualification_id).toBe("q-current");
      expect(p.expected_current_qualification_id).toBe("q-current");
    });
  });

  it("mesmo período detectado no preflight → bloqueia antes do Storage e oferece Substituir", async () => {
    preflightMaybeSingle.mockResolvedValue({
      data: {
        id: "q-current",
        worker_id: "w-1",
        document_type_id: "dt-nr-35",
        issued_at: "2025-02-01",
        expires_at: "2027-02-01",
      },
      error: null,
    });
    const onRequestReplace = vi.fn();
    renderDrawer({ onRequestReplace });
    await fillCommonFields({ issued: "2025-02-01", expires: "2027-02-01" });
    fireEvent.click(await screen.findByTestId("save-qualification"));

    await screen.findByTestId("sst-drawer-replace-now");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalledWith("register_sst_revision", expect.anything());

    fireEvent.click(screen.getByTestId("sst-drawer-replace-now"));
    expect(onRequestReplace).toHaveBeenCalledWith(expect.objectContaining({ id: "q-current" }));
  });

  it("corrida: preflight vazio, RPC retorna qualification_current_version_exists → rollback do arquivo e CTA correto, campos preservados", async () => {
    // 1ª chamada de preflight: vazio; 2ª (após conflito): vigente distinta
    preflightMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: "q-race",
          worker_id: "w-1",
          document_type_id: "dt-nr-35",
          issued_at: "2023-01-01",
          expires_at: "2025-01-01",
        },
        error: null,
      });
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "register_sst_revision") {
        return { data: null, error: { message: "qualification_current_version_exists" } };
      }
      return { data: null, error: null };
    });

    renderDrawer();
    await fillCommonFields();
    fireEvent.click(await screen.findByTestId("save-qualification"));

    // Rollback do arquivo recém-enviado
    await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(1));
    // CTA de renovar aparece (período diferente da vigente descoberta)
    await screen.findByTestId("sst-drawer-renew-now");
    // Nunca vaza jargão SQL / 23505
    const errBox = screen.getByTestId("sst-drawer-error");
    expect(errBox.textContent || "").not.toMatch(/23505|duplicate key|unique constraint/i);
    // Arquivo/dados preservados
    expect(screen.getByText(/cert\.pdf/)).toBeTruthy();
  });
});