// Exportação do Painel de Qualificações (CSV + XLSX).
// Respeita filtros ativos (search, state, onlyRelevant) e as colunas
// selecionadas pelo usuário. Nunca trunca silenciosamente: busca por
// offsets até cobrir o total antes de gerar o arquivo.
import { supabase } from "@/integrations/supabase/client";
import type { QualMatrix, QualRow, QualStatus } from "@/hooks/useWorkerQualifications";

const STATUS_PT: Record<QualStatus, string> = {
  ok: "Válido",
  warning: "Vence em breve",
  expired: "Vencido",
  missing: "Ausente",
  not_applicable: "Não aplicável",
  context_unresolved: "Contexto pendente",
};

export interface QualExportParams {
  search: string;
  state: QualStatus | null;
  onlyActiveContexts: boolean;
  documentTypeIds: string[]; // exatamente as colunas selecionadas
}

const PAGE = 500;

export async function fetchAllQualificationRows(p: QualExportParams): Promise<QualMatrix> {
  if (p.documentTypeIds.length === 0) {
    throw new Error("Selecione ao menos uma coluna antes de exportar.");
  }
  let offset = 0;
  let first: QualMatrix | null = null;
  const all: QualRow[] = [];
  for (;;) {
    const { data, error } = await supabase.rpc("list_worker_qualifications", {
      p_search: p.search || null,
      p_state: p.state || null,
      p_document_type_ids: p.documentTypeIds,
      // Espelha exatamente o contrato do hook useWorkerQualifications:
      // quando o switch "Somente com vínculo ativo" está ligado, filtra
      // por contexto operacional ativo e desliga o filtro por relevância.
      p_only_active_contexts: p.onlyActiveContexts,
      p_only_relevant: false,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const page = data as unknown as QualMatrix;
    if (!first) first = page;
    all.push(...(page.items || []));
    const total = page.total ?? all.length;
    offset += (page.items || []).length;
    if ((page.items || []).length === 0 || all.length >= total) break;
  }
  return { ...(first as QualMatrix), items: all, total: all.length };
}

function fmtDateBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function neutralizeCsvCell(v: string): string {
  // Preserva tabulação e CR; neutraliza somente prefixos executáveis.
  const first = v.length > 0 ? v.charAt(0) : "";
  if (first === "=" || first === "+" || first === "-" || first === "@") {
    return "'" + v;
  }
  return v;
}

function csvEscape(v: string): string {
  const s = neutralizeCsvCell(v == null ? "" : String(v));
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface BuiltHeader { label: string; getter: (row: QualRow) => string }

function buildHeaders(matrix: QualMatrix): BuiltHeader[] {
  const heads: BuiltHeader[] = [
    { label: "Trabalhador", getter: (r) => r.worker_name },
    { label: "CPF", getter: (r) => r.cpf ?? "" },
  ];
  for (const col of matrix.columns) {
    const label = col.name;
    heads.push({
      label: `${label} Status`,
      getter: (r) => {
        const cell = r.cells.find((c) => c.document_type_id === col.document_type_id);
        return cell ? STATUS_PT[cell.status] : "";
      },
    });
    heads.push({
      label: `${label} Validade`,
      getter: (r) => {
        const cell = r.cells.find((c) => c.document_type_id === col.document_type_id);
        return cell ? fmtDateBR(cell.expiry_date) : "";
      },
    });
  }
  return heads;
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

export async function exportQualificationsCsv(matrix: QualMatrix) {
  const heads = buildHeaders(matrix);
  const head = heads.map((h) => csvEscape(h.label)).join(";");
  const body = matrix.items
    .map((r) => heads.map((h) => csvEscape(h.getter(r))).join(";"))
    .join("\n");
  const csv = "\uFEFF" + head + "\n" + body + "\n";
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `qualificacoes_${timestamp()}.csv`);
}

export async function exportQualificationsXlsx(matrix: QualMatrix) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Qualificações");
  const heads = buildHeaders(matrix);
  ws.columns = heads.map((h) => ({ header: h.label, key: h.label, width: 22 }));
  ws.getRow(1).font = { bold: true };
  for (const r of matrix.items) {
    const row: Record<string, string> = {};
    heads.forEach((h) => { row[h.label] = h.getter(r); });
    ws.addRow(row);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: heads.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `qualificacoes_${timestamp()}.xlsx`,
  );
}