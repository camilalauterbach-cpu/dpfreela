import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePayrollBatch, usePayrollBatchItems, usePayrollReceipts, usePayrollItemReceipts } from "@/hooks/usePayroll";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { exportPayrollBatchXlsx } from "@/lib/export-payroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, CheckCircle, Download, Edit, FileUp, Loader2, Plus, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { ImportLinksDialog } from "@/components/payroll/ImportLinksDialog";
import { ReceiptsList } from "@/components/payroll/ReceiptsList";
import { PayrollItemForm } from "@/components/payroll/PayrollItemForm";

const statusLabel: Record<string, string> = { draft: "Rascunho", approved: "Aprovado", paid: "Pago", cancelled: "Cancelado" };
const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = { draft: "outline", approved: "secondary", paid: "default", cancelled: "destructive" };

export default function PayrollDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const canManageStatus = hasAnyRole(["admin", "manager"]);

  const { data: batch, isLoading } = usePayrollBatch(id);
  const { data: items } = usePayrollBatchItems(id);
  const { data: batchReceipts } = usePayrollReceipts(id);
  const itemIds = items?.map((i: any) => i.id) || [];
  const { data: itemReceipts } = usePayrollItemReceipts(itemIds);

  const [showImport, setShowImport] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [showAddItem, setShowAddItem] = useState(false);

  const isDraft = batch?.status === "draft";
  const isApproved = batch?.status === "approved";
  const isPaid = batch?.status === "paid";
  const isCancelled = batch?.status === "cancelled";

  // Check receipt requirements
  const hasBatchReceipt = (batchReceipts?.length || 0) > 0;
  const allItemsHaveReceipts = items?.length
    ? items.every((item: any) => itemReceipts?.some((r: any) => r.item_id === item.id))
    : false;
  const canMarkPaid = hasBatchReceipt || allItemsHaveReceipts;

  const fmt = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const totalNet = items?.reduce((sum: number, i: any) => sum + (Number(i.net_amount) || 0), 0) || 0;

  const statusMutation = useMutation({
    mutationFn: async ({ status, paid_at }: { status: string; paid_at?: string }) => {
      const payload: any = { status, total_amount: totalNet };
      if (paid_at) payload.paid_at = paid_at;
      const { error } = await supabase.from("payroll_batches").update(payload).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batch", id] });
      queryClient.invalidateQueries({ queryKey: ["payroll-batches"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("payroll_batch_items").update({ deleted_at: new Date().toISOString() }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batch-items", id] });
      toast({ title: "Item removido" });
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!batch) return <div className="text-center py-12 text-muted-foreground">Lote não encontrado.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Button>
      </div>

      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-xl">{batch.batch_name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {(batch.events as any)?.name && <span>Evento: {(batch.events as any).name}</span>}
              {batch.reference_month && <span>• Ref: {batch.reference_month}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={statusVariant[batch.status]}>{statusLabel[batch.status]}</Badge>
            <span className="text-lg font-semibold">{fmt(totalNet)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {isDraft && canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={() => navigate(`/payroll/${id}/edit`)}><Edit className="mr-1 h-3 w-3" /> Editar</Button>
                {canManageStatus && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm"><CheckCircle className="mr-1 h-3 w-3" /> Aprovar</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Aprovar lote?</AlertDialogTitle>
                        <AlertDialogDescription>Após aprovação, os itens não poderão mais ser editados.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => statusMutation.mutate({ status: "approved" })}>Aprovar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </>
            )}

            {isApproved && canManageStatus && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" disabled={!canMarkPaid} onClick={() => statusMutation.mutate({ status: "paid", paid_at: new Date().toISOString() })}>
                      <CheckCircle className="mr-1 h-3 w-3" /> Marcar como Pago
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canMarkPaid && (
                  <TooltipContent>
                    <p>Anexe um comprovante ao lote ou a todos os itens para concluir o pagamento.</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            {(isDraft || isApproved) && canManageStatus && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Cancelar Lote</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar lote?</AlertDialogTitle>
                    <AlertDialogDescription>Esta ação é irreversível.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => statusMutation.mutate({ status: "cancelled" })}>Confirmar Cancelamento</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button size="sm" variant="outline" onClick={() => exportPayrollBatchXlsx(batch, items || [])}>
              <Download className="mr-1 h-3 w-3" /> Exportar
            </Button>
          </div>

          {isApproved && !canMarkPaid && (
            <div className="mt-3 flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Anexe um comprovante ao lote ou a todos os itens para poder marcar como pago.
            </div>
          )}

          {batch.notes && <p className="mt-3 text-sm text-muted-foreground">{batch.notes}</p>}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Itens do Lote</CardTitle>
          {isDraft && canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowImport(true)}><FileUp className="mr-1 h-3 w-3" /> Importar Vínculos</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditingItem(null); setShowAddItem(true); }}><Plus className="mr-1 h-3 w-3" /> Adicionar</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {showAddItem && isDraft && (
            <div className="mb-4">
              <PayrollItemForm batchId={id!} eventId={batch.event_id} onClose={() => setShowAddItem(false)} />
            </div>
          )}
          {editingItem && isDraft && (
            <div className="mb-4">
              <PayrollItemForm batchId={id!} eventId={batch.event_id} existing={editingItem} onClose={() => setEditingItem(null)} />
            </div>
          )}

          {!items?.length ? (
            <p className="text-center py-6 text-muted-foreground">Nenhum item no lote.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabalhador</TableHead>
                    <TableHead className="hidden md:table-cell">Função</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Base</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Extras</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Bônus</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Descontos</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="hidden sm:table-cell">Comprov.</TableHead>
                    {isDraft && canEdit && <TableHead className="w-20">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => {
                    const hasItemReceipt = itemReceipts?.some((r: any) => r.item_id === item.id);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{(item.workers as any)?.full_name || "—"}</span>
                            {(item.workers as any)?.nickname && (
                              <span className="text-muted-foreground text-xs ml-1">({(item.workers as any).nickname})</span>
                            )}
                            <p className="md:hidden text-xs text-muted-foreground">{(item.employment_links as any)?.job_role || ""}</p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{(item.employment_links as any)?.job_role || "—"}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right">{fmt(item.base_amount)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right">{fmt(item.overtime_amount)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right">{fmt(item.bonuses)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right">{fmt(item.deductions)}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(item.net_amount)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{hasItemReceipt || hasBatchReceipt ? <Badge variant="secondary" className="text-xs">✓</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        {isDraft && canEdit && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingItem(item)}><Edit className="h-3 w-3" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteItemMutation.mutate(item.id)}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipts */}
      {!isCancelled && (
        <ReceiptsList batchId={id!} canUpload={isDraft || isApproved || isPaid} />
      )}

      {/* Import Dialog */}
      {showImport && (
        <ImportLinksDialog batchId={id!} eventId={batch.event_id} existingWorkerIds={items?.map((i: any) => i.worker_id) || []} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
