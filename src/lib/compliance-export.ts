import type { ComplianceListItem } from "@/hooks/useLinkComplianceList";
import { OVERALL_LABEL } from "@/hooks/useLinkCompliance";

interface Row {
  Trabalhador: string;
  Cargo: string;
  Documento: string;
  Codigo: string;
  Status: string;
  Motivo: string;
  Validade: string;
  DiasRestantes: string;
  ConformidadeGeral: string;
}

function toRows(items: ComplianceListItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    const overall = OVERALL_LABEL[it.overall] ?? it.overall;
    if (!it.documents.length) {
      rows.push({
        Trabalhador: it.worker_name ?? "",
        Cargo: it.job_role_name ?? "",
        Documento: "—",
        Codigo: "",
        Status: "",
        Motivo: "Sem requisitos definidos",
        Validade: "",
        DiasRestantes: "",
        ConformidadeGeral: overall,
      });
      continue;
    }
    for (const d of it.documents) {
      rows.push({
        Trabalhador: it.worker_name ?? "",
        Cargo: it.job_role_name ?? "",
        Documento: d.name,
        Codigo: d.code,
        Status: d.status_label,
        Motivo: d.status_reason,
        Validade: d.expires_at ?? "",
        DiasRestantes: d.days_remaining == null ? "" : String(d.days_remaining),
        ConformidadeGeral: overall,
      });
    }
  }
  return rows;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string) {
  if (/[";\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportComplianceCSV(items: ComplianceListItem[], baseName = "conformidade") {
  const rows = toRows(items);
  const headers = Object.keys(rows[0] ?? {
    Trabalhador: "", Cargo: "", Documento: "", Codigo: "", Status: "",
    Motivo: "", Validade: "", DiasRestantes: "", ConformidadeGeral: "",
  });
  const csv = [
    headers.join(";"),
    ...rows.map((r) => headers.map((h) => csvEscape(String((r as any)[h] ?? ""))).join(";")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  download(blob, `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportComplianceXLSX(items: ComplianceListItem[], baseName = "conformidade") {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new (ExcelJS as any).Workbook();
  const ws = wb.addWorksheet("Conformidade");
  const rows = toRows(items);
  const headers = [
    "Trabalhador", "Cargo", "Documento", "Código",
    "Status", "Motivo", "Validade", "Dias restantes", "Conformidade geral",
  ];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      r.Trabalhador, r.Cargo, r.Documento, r.Codigo,
      r.Status, r.Motivo, r.Validade, r.DiasRestantes, r.ConformidadeGeral,
    ]);
  }
  ws.columns.forEach((c: any) => { c.width = 20; });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  download(blob, `${baseName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}