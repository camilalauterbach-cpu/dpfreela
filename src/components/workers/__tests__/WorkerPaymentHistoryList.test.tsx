import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { summarizePayments, WorkerPaymentHistoryList } from "../WorkerPaymentHistoryList";

// ---- Mocks ----------------------------------------------------------------
const updateSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const isSpy = vi.fn();

type Row = any;
let itemsData: Row[] = [];
let receiptsData: Row[] = [];
let itemsError: any = null;
let updateError: any = null;

// Builders return a thenable to await the terminal query.
function itemsBuilder() {
  const b: any = {
    select: () => b,
    eq: () => b,
    is: () => b,
    order: () => Promise.resolve({ data: itemsData, error: itemsError }),
  };
  return b;
}
function receiptsSelectBuilder() {
  const b: any = {
    select: () => b,
    in: () => b,
    is: () => Promise.resolve({ data: receiptsData, error: null }),
  };
  return b;
}
function receiptsUpdateBuilder(patch: any) {
  updateSpy("payment_receipts", patch);
  const b: any = {
    eq: () => b,
    is: () => Promise.resolve({ error: null }),
  };
  return b;
}
function itemsUpdateBuilder(patch: any) {
  updateSpy("payroll_batch_items", patch);
  const b: any = {
    eq: () => Promise.resolve({ error: updateError }),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "payroll_batch_items") {
        return {
          select: () => itemsBuilder(),
          update: (patch: any) => itemsUpdateBuilder(patch),
        };
      }
      if (table === "payment_receipts") {
        return {
          select: () => receiptsSelectBuilder(),
          update: (patch: any) => receiptsUpdateBuilder(patch),
        };
      }
      throw new Error("unexpected table: " + table);
    },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: any[]) => toastSuccess(...a), error: (...a: any[]) => toastError(...a) },
}));

let mockRoles = ["admin"];
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    hasAnyRole: (roles: string[]) => roles.some((r) => mockRoles.includes(r)),
  }),
}));

function renderWithClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkerPaymentHistoryList workerId="w1" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  updateSpy.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  itemsError = null;
  updateError = null;
  mockRoles = ["admin"];
  itemsData = [
    {
      id: "it1",
      batch_id: "b1",
      net_amount: 1000,
      base_amount: 1000,
      overtime_amount: 0,
      bonuses: 0,
      deductions: 0,
      notes: null,
      created_at: "2026-07-01T12:00:00Z",
      payroll_batches: {
        batch_name: "Folha Julho",
        status: "completed",
        paid_at: "2026-07-05T12:00:00Z",
        reference_month: "2026-07",
      },
    },
    {
      id: "it2",
      batch_id: "b2",
      net_amount: 500,
      base_amount: 500,
      overtime_amount: 0,
      bonuses: 0,
      deductions: 0,
      notes: null,
      created_at: "2026-08-01T12:00:00Z",
      payroll_batches: {
        batch_name: "Folha Agosto",
        status: "draft",
        paid_at: null,
        reference_month: "2026-08",
      },
    },
  ];
  receiptsData = [{ item_id: "it1" }];
});

describe("summarizePayments", () => {
  it("derives totals from rows without manual input", () => {
    const s = summarizePayments(itemsData as any);
    expect(s.totalPaid).toBe(1000);
    expect(s.totalPending).toBe(500);
    expect(s.paidCount).toBe(1);
    expect(s.pendingCount).toBe(1);
    expect(s.grandTotal).toBe(1500);
  });
});

describe("WorkerPaymentHistoryList", () => {
  it("shows the disclaimer that it is not a bank data form", async () => {
    renderWithClient();
    expect(
      await screen.findByText(/não serve para cadastrar contas bancárias/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Folha de Pagamento/i)).toBeInTheDocument();
  });

  it("recalculates KPIs and history after a confirmed deletion", async () => {
    renderWithClient();
    const row = await screen.findByTestId("payment-row-it1");
    fireEvent.click(within(row).getByTestId("delete-payment-it1"));
    // Confirmation dialog surfaces
    const confirm = await screen.findByRole("button", { name: /excluir$/i });
    // Update after deletion: rows shrink to only pending
    itemsData = [itemsData[1]];
    receiptsData = [];
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "payment_receipts",
        expect.objectContaining({ deleted_at: expect.any(String) })
      )
    );
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "payroll_batch_items",
        expect.objectContaining({ deleted_at: expect.any(String) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // KPI Total pago recalculated to R$ 0,00 (only pending remains)
    await waitFor(() => {
      const kpi = screen.getByTestId("kpi-total-paid");
      expect(kpi.textContent).toMatch(/R\$\s*0,00/);
    });
    expect(screen.queryByTestId("payment-row-it1")).not.toBeInTheDocument();
  });

  it("does nothing when the user cancels the confirmation", async () => {
    renderWithClient();
    const row = await screen.findByTestId("payment-row-it1");
    fireEvent.click(within(row).getByTestId("delete-payment-it1"));
    const cancel = await screen.findByRole("button", { name: /cancelar/i });
    fireEvent.click(cancel);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("payment-row-it1")).toBeInTheDocument();
  });

  it("hides the delete action for users without permission", async () => {
    mockRoles = ["viewer"];
    renderWithClient();
    await screen.findByTestId("payment-row-it1");
    expect(screen.queryByTestId("delete-payment-it1")).not.toBeInTheDocument();
  });

  it("shows a human error message and does not crash on failure", async () => {
    updateError = { message: "row-level security violation: permission denied" };
    renderWithClient();
    const row = await screen.findByTestId("payment-row-it1");
    fireEvent.click(within(row).getByTestId("delete-payment-it1"));
    fireEvent.click(await screen.findByRole("button", { name: /excluir$/i }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Erro ao excluir pagamento",
        expect.objectContaining({
          description: expect.stringMatching(/permissão/i),
        })
      )
    );
    // Row remains visible — no crash
    expect(screen.getByTestId("payment-row-it1")).toBeInTheDocument();
  });
});