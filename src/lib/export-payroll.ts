import ExcelJS from "exceljs";

export async function exportPayrollBatchXlsx(batch: any, items: any[]) {
  const wb = new ExcelJS.Workbook();

  // Items sheet
  const ws = wb.addWorksheet("Itens do Lote");
  ws.columns = [
    { header: "Trabalhador", key: "worker", width: 25 },
    { header: "Apelido", key: "nickname", width: 15 },
    { header: "CPF", key: "cpf", width: 15 },
    { header: "Vínculo", key: "link", width: 20 },
    { header: "Função", key: "role", width: 15 },
    { header: "Valor Base", key: "base", width: 12 },
    { header: "Horas Extras", key: "overtime", width: 12 },
    { header: "Bonificações", key: "bonuses", width: 12 },
    { header: "Descontos", key: "deductions", width: 12 },
    { header: "Valor Líquido", key: "net", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Observações", key: "notes", width: 20 },
  ];

  for (const item of items) {
    ws.addRow({
      worker: (item.workers as any)?.full_name || "",
      nickname: (item.workers as any)?.nickname || "",
      cpf: (item.workers as any)?.cpf || "",
      link: (item.employment_links as any)?.link_name || "",
      role: (item.employment_links as any)?.job_roles?.name || (item.employment_links as any)?.job_role || "",
      base: Number(item.base_amount) || 0,
      overtime: Number(item.overtime_amount) || 0,
      bonuses: Number(item.bonuses) || 0,
      deductions: Number(item.deductions) || 0,
      net: Number(item.net_amount) || 0,
      status: item.status === "paid" ? "Pago" : item.status === "pending" ? "Pendente" : item.status === "cancelled" ? "Cancelado" : item.status,
      notes: item.notes || "",
    });
  }

  // Summary sheet
  const ws2 = wb.addWorksheet("Resumo");
  ws2.columns = [
    { header: "Campo", key: "campo", width: 20 },
    { header: "Valor", key: "valor", width: 30 },
  ];
  ws2.addRows([
    { campo: "Lote", valor: batch.batch_name },
    { campo: "Evento", valor: (batch.events as any)?.name || "—" },
    { campo: "Mês Referência", valor: batch.reference_month || "—" },
    { campo: "Status", valor: batch.status },
    { campo: "Valor Total", valor: Number(batch.total_amount) || 0 },
    { campo: "Data Pagamento", valor: batch.paid_at ? new Date(batch.paid_at).toLocaleDateString("pt-BR") : "—" },
  ]);

  const fileName = `Lote_${batch.batch_name?.replace(/\s+/g, "_") || "pagamento"}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
