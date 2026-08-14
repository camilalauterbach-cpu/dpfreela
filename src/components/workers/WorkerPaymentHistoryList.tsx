import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Trash2, Info, FileText, Receipt, Landmark } from "lucide-react";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

interface Props {
  workerId: string;
}

interface PaymentRow {
  id: string;
  batch_id: string;
  net_amount: number;
  base_amount: number;
  overtime_amount: number | null;
  bonuses: number | null;
  deductions: number | null;
  notes: string | null;
  created_at: string;
  payroll_batches?: {
    batch_name: string;
    status: string;
    paid_at: string | null;
    reference_month: string | null;
  } | null;
  receipts_count?: number;
}

const BRL = (v: number) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

export function summarizePayments(rows: PaymentRow[]) {
  let totalPaid = 0;
  let totalPending = 0;
  let paidCount = 0;
  let pendingCount = 0;
  for (const r of rows) {
    const isPaid = r.payroll_batches?.status === "completed" || !!r.payroll_batches?.paid_at;
    if (isPaid) {
      totalPaid += Number(r.net_amount) || 0;
      paidCount += 1;
    } else {
      totalPending += Number(r.net_amount) || 0;
      pendingCount += 1;
    }
  }
  return {
    totalPaid,
    totalPending,
    paidCount,
    pendingCount,
    totalCount: rows.length,
    grandTotal: totalPaid + totalPending,
  };
}

export function WorkerPaymentHistoryList({ workerId }: Props) {
  const { hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(["admin", "manager"]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<PaymentRow | null>(null);

  const goToBankData = () => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "documentos");
    next.set("category", "bank_document");
    setSearchParams(next);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["worker-payment-history", workerId],
    enabled: !!workerId,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data: items, error: itemsError } = await supabase
        .from("payroll_batch_items")
        .select(
          "id, batch_id, net_amount, base_amount, overtime_amount, bonuses, deductions, notes, created_at, payroll_batches:batch_id(batch_name, status, paid_at, reference_month)"
        )
        .eq("worker_id", workerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (itemsError) throw itemsError;
      const rows = (items ?? []) as any as PaymentRow[];
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const { data: rcpts } = await supabase
          .from("payment_receipts")
          .select("item_id")
          .in("item_id", ids)
          .is("deleted_at", null);
        const counts = new Map<string, number>();
        for (const r of (rcpts ?? []) as any[]) {
          counts.set(r.item_id, (counts.get(r.item_id) ?? 0) + 1);
        }
        rows.forEach((r) => (r.receipts_count = counts.get(r.id) ?? 0));
      }
      return rows;
    },
  });

  const rows = data ?? [];
  const summary = useMemo(() => summarizePayments(rows), [rows]);

  const deleteMutation = useMutation({
    mutationFn: async (row: PaymentRow) => {
      const now = new Date().toISOString();
      // 1) Soft-delete item-scoped receipts (documento vinculado ao pagamento)
      const { error: rcptErr } = await supabase
        .from("payment_receipts")
        .update({ deleted_at: now })
        .eq("item_id", row.id)
        .is("deleted_at", null);
      if (rcptErr) throw rcptErr;
      // 2) Soft-delete the payment record itself
      const { error: itemErr } = await supabase
        .from("payroll_batch_items")
        .update({ deleted_at: now })
        .eq("id", row.id);
      if (itemErr) throw itemErr;
    },
    onSuccess: () => {
      toast.success("Pagamento excluído", {
        description: "O registro e o comprovante vinculado foram removidos.",
      });
      queryClient.invalidateQueries({ queryKey: ["worker-payment-history", workerId] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch-items"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batch"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-item-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-counts"] });
      setPendingDelete(null);
    },
    onError: (err: any) => {
      const msg = err?.message?.toLowerCase?.() ?? "";
      const friendly =
        msg.includes("permission") || msg.includes("row-level")
          ? "Você não tem permissão para excluir este pagamento."
          : "Não foi possível excluir o pagamento agora. Tente novamente em instantes.";
      toast.error("Erro ao excluir pagamento", { description: friendly });
    },
  });

  return (
    <div className="space-y-4" data-testid="worker-payment-history">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Histórico de pagamentos realizados</AlertTitle>
        <AlertDescription>
          Esta aba não serve para cadastrar contas bancárias ou chaves Pix. Ela
          registra pagamentos efetivamente feitos ao trabalhador — data, valor e
          comprovante — e mantém esses documentos disponíveis para fiscalização.
          Totais, saldo e histórico são calculados automaticamente a partir dos
          registros. Para criar um novo pagamento, use o módulo Folha de
          Pagamento.
          <span className="mt-2 block">
            Contas bancárias e chaves Pix do trabalhador ficam na aba{" "}
            <strong>Documentos</strong>, na seção Documento bancário.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            data-testid="go-to-bank-data"
            onClick={goToBankData}
          >
            <Landmark className="mr-1 h-3 w-3" /> Gerenciar dados bancários / Pix
          </Button>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="kpi-total-paid">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Total pago</p>
            <p className="text-lg font-semibold">{BRL(summary.totalPaid)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.paidCount} pagamento(s)</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-total-pending">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Saldo a pagar</p>
            <p className="text-lg font-semibold">{BRL(summary.totalPending)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.pendingCount} em aberto</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-grand-total">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Total registrado</p>
            <p className="text-lg font-semibold">{BRL(summary.grandTotal)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.totalCount} registro(s)</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-receipts">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Com comprovante</p>
            <p className="text-lg font-semibold">
              {rows.filter((r) => (r.receipts_count ?? 0) > 0).length}
            </p>
            <p className="text-[11px] text-muted-foreground">de {rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pagamentos registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-4 text-sm text-destructive">
              Não foi possível carregar os pagamentos.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum pagamento registrado para este trabalhador.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const isPaid =
                  r.payroll_batches?.status === "completed" || !!r.payroll_batches?.paid_at;
                return (
                  <div
                    key={r.id}
                    data-testid={`payment-row-${r.id}`}
                    className="flex items-start justify-between gap-3 rounded-md border px-3 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{BRL(Number(r.net_amount))}</span>
                        <Badge variant={isPaid ? "default" : "secondary"} className="text-xs">
                          {isPaid ? "Pago" : "Em aberto"}
                        </Badge>
                        {(r.receipts_count ?? 0) > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <Receipt className="mr-1 h-3 w-3" />
                            {r.receipts_count} comprovante(s)
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.payroll_batches?.batch_name || "Lote"} •{" "}
                        {isPaid
                          ? `Pago em ${fmtDate(r.payroll_batches?.paid_at ?? r.created_at)}`
                          : `Registrado em ${fmtDate(r.created_at)}`}
                        {r.payroll_batches?.reference_month
                          ? ` • Ref. ${r.payroll_batches.reference_month}`
                          : ""}
                      </p>
                      {r.notes && (
                        <p className="text-xs text-muted-foreground flex items-start gap-1">
                          <FileText className="h-3 w-3 mt-0.5 shrink-0" /> {r.notes}
                        </p>
                      )}
                    </div>
                    {canDelete && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0"
                        aria-label="Excluir pagamento"
                        data-testid={`delete-payment-${r.id}`}
                        onClick={() => setPendingDelete(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="Excluir pagamento"
        description={
          pendingDelete
            ? `Será removido apenas este pagamento de ${BRL(Number(pendingDelete.net_amount))}` +
              (pendingDelete.payroll_batches?.batch_name
                ? ` do lote "${pendingDelete.payroll_batches.batch_name}"`
                : "") +
              ((pendingDelete.receipts_count ?? 0) > 0
                ? ` e o(s) ${pendingDelete.receipts_count} comprovante(s) vinculado(s) a ele.`
                : ".") +
              " Outros pagamentos, documentos e o cadastro do trabalhador não serão afetados."
            : ""
        }
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}