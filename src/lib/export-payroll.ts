import * as XLSX from "xlsx";

export function exportPayrollBatchXlsx(batch: any, items: any[]) {
  const rows = items.map((item: any) => ({
    "Trabalhador": (item.workers as any)?.full_name || "",
    "Apelido": (item.workers as any)?.nickname || "",
    "CPF": (item.workers as any)?.cpf || "",
    "Vínculo": (item.employment_links as any)?.link_name || "",
    "Função": (item.employment_links as any)?.job_role || "",
    "Valor Base": Number(item.base_amount) || 0,
    "Horas Extras": Number(item.overtime_amount) || 0,
    "Bonificações": Number(item.bonuses) || 0,
    "Descontos": Number(item.deductions) || 0,
    "Valor Líquido": Number(item.net_amount) || 0,
    "Status": item.status === "paid" ? "Pago" : item.status === "pending" ? "Pendente" : item.status === "cancelled" ? "Cancelado" : item.status,
    "Observações": item.notes || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Itens do Lote");

  // Summary sheet
  const summary = [
    { Campo: "Lote", Valor: batch.batch_name },
    { Campo: "Evento", Valor: (batch.events as any)?.name || "—" },
    { Campo: "Mês Referência", Valor: batch.reference_month || "—" },
    { Campo: "Status", Valor: batch.status },
    { Campo: "Valor Total", Valor: Number(batch.total_amount) || 0 },
    { Campo: "Data Pagamento", Valor: batch.paid_at ? new Date(batch.paid_at).toLocaleDateString("pt-BR") : "—" },
  ];
  const ws2 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws2, "Resumo");

  const fileName = `Lote_${batch.batch_name?.replace(/\s+/g, "_") || "pagamento"}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
