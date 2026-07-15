// Entrega 7 — Exportação e gestão operacional do Controle SST.
// Uma linha por qualificação (nunca agregada). Todas as origens dos dados
// vêm da view worker_sst_qualifications_current e dos workers já carregados
// pelo hook useSstOverview — não há novas consultas aqui.

import type {
  SstCurrentRow,
  SstWorkerRow,
  ExpirationStatus,
  DocumentStatus,
  ValidityStatus,
} from "@/hooks/useSstQualifications";

export const EXP_LABEL_PT: Record<ExpirationStatus, string> = {
  valid: "Válido",
  expiring_soon: "Vence em 30d",
  expired: "Vencido",
  no_expiry: "Sem validade",
  unknown: "Validade desconhecida",
};
export const DOC_LABEL_PT: Record<DocumentStatus, string> = {
  ok: "Aprovado",
  pending: "Pendente",
  rejected: "Rejeitado",
  no_document: "Sem comprovante",
};
export const VAL_LABEL_PT: Record<ValidityStatus, string> = {
  has_expiry: "Possui vencimento",
  no_expiry: "Não possui vencimento",
  unknown: "Não informada",
};

export interface FlatSstRow {
  worker_name: string;
  worker_nickname: string;
  worker_cpf: string;
  nr_code: string;
  training_type: string;
  issued_at: string;
  expires_at: string;
  days_remaining: string;
  expiration_status: string;
  validity_status: string;
  document_status: string;
  revision_type: string;
  source_type: string;
  provider_name: string;
  instructor_name: string;
  workload_hours: string;
  notes: string;
}

export function daysRemaining(expires_at: string | null): number | null {
  if (!expires_at) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(expires_at + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return diff;
}

function fmtDateBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Achata trabalhadores → uma linha por qualificação, respeitando a ordem já filtrada. */
export function flattenWorkers(workers: SstWorkerRow[]): FlatSstRow[] {
  const rows: FlatSstRow[] = [];
  for (const w of workers) {
    const sorted = [...w.qualifications].sort((a, b) => a.nr_code.localeCompare(b.nr_code));
    for (const q of sorted) {
      const dr = daysRemaining(q.expires_at);
      rows.push({
        worker_name: w.full_name,
        worker_nickname: w.nickname ?? "",
        worker_cpf: w.cpf ?? "",
        nr_code: q.nr_code,
        training_type: q.training_type ?? "",
        issued_at: fmtDateBR(q.issued_at),
        expires_at: fmtDateBR(q.expires_at),
        days_remaining: dr == null ? "" : String(dr),
        expiration_status: EXP_LABEL_PT[q.expiration_status] ?? q.expiration_status,
        validity_status: VAL_LABEL_PT[q.validity_status] ?? q.validity_status,
        document_status: DOC_LABEL_PT[q.document_status] ?? q.document_status,
        revision_type: q.revision_type,
        source_type: q.source_type,
        provider_name: q.provider_name ?? "",
        instructor_name: q.instructor_name ?? "",
        workload_hours: q.workload_hours == null ? "" : String(q.workload_hours),
        notes: q.notes ?? "",
      });
    }
  }
  return rows;
}

const HEADERS: Array<{ key: keyof FlatSstRow; label: string }> = [
  { key: "worker_name", label: "Trabalhador" },
  { key: "worker_nickname", label: "Apelido" },
  { key: "worker_cpf", label: "CPF" },
  { key: "nr_code", label: "NR" },
  { key: "training_type", label: "Treinamento" },
  { key: "issued_at", label: "Emissão" },
  { key: "expires_at", label: "Vencimento" },
  { key: "days_remaining", label: "Dias restantes" },
  { key: "expiration_status", label: "Situação da validade" },
  { key: "validity_status", label: "Tipo de validade" },
  { key: "document_status", label: "Documento" },
  { key: "revision_type", label: "Revisão" },
  { key: "source_type", label: "Origem" },
  { key: "provider_name", label: "Prestador" },
  { key: "instructor_name", label: "Instrutor" },
  { key: "workload_hours", label: "Carga horária (h)" },
  { key: "notes", label: "Observações" },
];

function csvEscape(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(rows: FlatSstRow[]): string {
  const head = HEADERS.map((h) => csvEscape(h.label)).join(";");
  const body = rows.map((r) => HEADERS.map((h) => csvEscape(r[h.key])).join(";")).join("\n");
  // BOM para Excel abrir com acentos corretos.
  return "\uFEFF" + head + "\n" + body + "\n";
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportCsv(rows: FlatSstRow[], suffix = "") {
  const csv = buildCsv(rows);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `controle_sst_${suffix ? suffix + "_" : ""}${timestamp()}.csv`);
}

export async function exportXlsx(rows: FlatSstRow[], suffix = "") {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Controle SST");
  ws.columns = HEADERS.map((h) => ({ header: h.label, key: h.key, width: 22 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `controle_sst_${suffix ? suffix + "_" : ""}${timestamp()}.xlsx`);
}

/** Resumo por trabalhador em PDF (conferência interna). */
export async function exportPdfSummary(workers: SstWorkerRow[], suffix = "") {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const now = new Date();
  doc.setFontSize(14);
  doc.text("Controle SST — Resumo por trabalhador", 40, 40);
  doc.setFontSize(9);
  doc.text(
    `Gerado em ${now.toLocaleString("pt-BR")} — ${workers.length} trabalhador(es)`,
    40, 56,
  );
  let y = 74;
  for (const w of workers) {
    const sorted = [...w.qualifications].sort((a, b) => a.nr_code.localeCompare(b.nr_code));
    const body = sorted.map((q) => [
      q.nr_code,
      fmtDateBR(q.issued_at),
      fmtDateBR(q.expires_at),
      (() => { const dr = daysRemaining(q.expires_at); return dr == null ? "—" : String(dr); })(),
      EXP_LABEL_PT[q.expiration_status] ?? q.expiration_status,
      DOC_LABEL_PT[q.document_status] ?? q.document_status,
    ]);
    autoTable(doc, {
      startY: y,
      head: [["NR", "Emissão", "Vencimento", "Dias", "Situação", "Documento"]],
      body: body.length ? body : [["—", "—", "—", "—", "—", "—"]],
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [26, 39, 68] },
      margin: { left: 40, right: 40 },
      didDrawPage: () => { /* no-op */ },
      willDrawPage: () => {
        doc.setFontSize(10);
        doc.text(`${w.full_name}${w.cpf ? ` — CPF ${w.cpf}` : ""}`, 40, (doc as any).lastAutoTable ? 30 : 30);
      },
    });
    doc.setFontSize(10);
    // Título do bloco acima da tabela
    doc.text(`${w.full_name}${w.cpf ? ` — CPF ${w.cpf}` : ""}`, 40, y - 6);
    const finalY = (doc as any).lastAutoTable?.finalY ?? y + 40;
    y = finalY + 24;
    if (y > 780) { doc.addPage(); y = 60; }
  }
  doc.save(`controle_sst_${suffix ? suffix + "_" : ""}resumo_${timestamp()}.pdf`);
}

/** Ordenação por prioridade operacional (menor = mais urgente). */
export function priorityRank(q: SstCurrentRow): number {
  // 1) vencidos, 2) rejeitados, 3) vencendo em 7d, 4) 15d, 5) 30d,
  // 6) doc pendente, 7) sem comprovante, 8) validade desconhecida.
  const dr = daysRemaining(q.expires_at);
  if (q.expiration_status === "expired") return 1;
  if (q.document_status === "rejected") return 2;
  if (q.expiration_status === "expiring_soon") {
    if (dr != null && dr <= 7) return 3;
    if (dr != null && dr <= 15) return 4;
    return 5;
  }
  if (q.document_status === "pending") return 6;
  if (q.document_status === "no_document") return 7;
  if (q.expiration_status === "unknown" || q.validity_status === "unknown") return 8;
  return 99;
}

export interface PendencyRow {
  worker: SstWorkerRow;
  q: SstCurrentRow;
  rank: number;
  daysLeft: number | null;
}

export function collectPendencies(workers: SstWorkerRow[]): PendencyRow[] {
  const out: PendencyRow[] = [];
  for (const w of workers) {
    for (const q of w.qualifications) {
      const rank = priorityRank(q);
      if (rank >= 99) continue;
      out.push({ worker: w, q, rank, daysLeft: daysRemaining(q.expires_at) });
    }
  }
  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.daysLeft != null && b.daysLeft != null && a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.worker.full_name.localeCompare(b.worker.full_name, "pt-BR");
  });
  return out;
}