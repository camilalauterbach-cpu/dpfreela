import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AsoValidityDialog } from "../AsoValidityDialog";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof AsoValidityDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onManageInDocuments = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AsoValidityDialog
        open
        onOpenChange={onOpenChange}
        workerId="w1"
        documentId="d1"
        documentTypeId="dt-aso"
        documentCode="ASO"
        currentIssuedAt="2026-01-10"
        currentExpiresAt="2026-04-10"
        onManageInDocuments={onManageInDocuments}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, onManageInDocuments };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("AsoValidityDialog", () => {
  it("desabilita salvar quando datas não mudaram", () => {
    renderDialog();
    const btn = screen.getByTestId("aso-validity-save") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("bloqueia vencimento anterior à emissão", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("aso-validity-expires-at"), {
      target: { value: "2026-01-01" },
    });
    const btn = screen.getByTestId("aso-validity-save") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/posterior à emissão/i)).toBeInTheDocument();
  });

  it("chama RPC com expected_current_id ao salvar", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("aso-validity-expires-at"), {
      target: { value: "2027-01-10" },
    });
    fireEvent.click(screen.getByTestId("aso-validity-save"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("correct_worker_document_validity", expect.any(Object)),
    );
    const call = rpcMock.mock.calls.find((c) => c[0] === "correct_worker_document_validity")!;
    expect(call[1]).toMatchObject({
      p_document_id: "d1",
      p_expected_current_id: "d1",
      p_issue_date: "2026-01-10",
      p_expiry_date: "2027-01-10",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("mapeia erro stale_current_document para mensagem clara", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "stale_current_document" },
    });
    renderDialog();
    fireEvent.change(screen.getByTestId("aso-validity-expires-at"), {
      target: { value: "2027-01-10" },
    });
    fireEvent.click(screen.getByTestId("aso-validity-save"));
    await waitFor(() =>
      expect(screen.getByTestId("aso-validity-error").textContent).toMatch(/recarregue/i),
    );
  });

  it("botão de gerenciar documentos dispara callback", () => {
    const { onManageInDocuments } = renderDialog();
    fireEvent.click(screen.getByText(/Gerenciar arquivo na aba Documentos/i));
    expect(onManageInDocuments).toHaveBeenCalled();
  });

  it("aguarda invalidações antes de fechar o diálogo", async () => {
    // reevaluate_worker_links é a RPC compartilhada disparada pelo
    // invalidateComplianceCaches; controlamos a resolução manualmente para
    // provar que onOpenChange(false) só ocorre depois dela.
    let resolveReeval: (v: unknown) => void = () => {};
    const reevalPromise = new Promise((r) => {
      resolveReeval = r;
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "correct_worker_document_validity") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      if (name === "reevaluate_worker_links") {
        return reevalPromise.then(() => ({ data: null, error: null }));
      }
      return Promise.resolve({ data: null, error: null });
    });
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("aso-validity-expires-at"), {
      target: { value: "2027-01-10" },
    });
    fireEvent.click(screen.getByTestId("aso-validity-save"));

    // Espera a RPC de correção terminar; o diálogo AINDA não pode fechar
    // porque a reavaliação compartilhada continua pendente.
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "reevaluate_worker_links",
        expect.any(Object),
      ),
    );
    // Micro-tarefas processadas — se o código NÃO awaitasse, já teria fechado.
    await Promise.resolve();
    await Promise.resolve();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Libera a reavaliação; agora o diálogo deve fechar.
    resolveReeval(undefined);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});