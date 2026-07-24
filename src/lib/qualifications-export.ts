// Exportação do Painel de Qualificações (CSV + XLSX).
// Respeita os filtros ativos de busca, estado e contexto operacional,
// além das colunas selecionadas pelo usuário. Nunca trunca
// silenciosamente: busca por offsets até cobrir o total antes de gerar
// o arquivo.
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
const MAX_PAGES = 10_000;

export async function fetchAllQualificationRows(p: QualExportParams): Promise<QualMatrix> {
  if (p.documentTypeIds.length === 0) {
    throw new Error("Selecione ao menos uma coluna antes de exportar.");
  }
  let offset = 0;
  let first: QualMatrix | null = null;
  const all: QualRow[] = [];
  let previousPageSignature: string | null = null;
  let pageCount = 0;
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
    const items = page.items ?? [];
    const pageSignature = items.map((it) => it.worker_id).join("|");
    if (items.length > 0 && pageSignature === previousPageSignature) {
      throw new Error(
        "A paginação da exportação não avançou. A RPC retornou a mesma página mais de uma vez.",
      );
    }
    previousPageSignature = pageSignature;
    all.push(...items);
    // Aceita tanto `total` quanto `total_workers` (contrato observado da RPC).
    // Se nenhum estiver presente, encerra ao primeiro page < PAGE.
    const totalRaw = page.total ?? page.total_workers ?? null;
    offset += items.length;
    pageCount += 1;
    if (pageCount > MAX_PAGES) {
      throw new Error("A exportação excedeu o limite seguro de páginas.");
    }
    if (items.length === 0) break;
    if (totalRaw !== null && all.length >= totalRaw) break;
    if (totalRaw === null && items.length < PAGE) break;
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
  // Neutraliza prefixos executáveis mesmo quando precedidos por espaços,
  // tabs ou quebras — Excel/Sheets ignoram esse whitespace ao avaliar
  // fórmulas.
  const s = v ?? "";
  if (/^[\s\t\r\n]*[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function csvEscape(v: string): string {
  const s = neutralizeCsvCell(v == null ? "" : String(v));
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface BuiltHeader { key: string; label: string; getter: (row: QualRow) => string }

function buildHeaders(matrix: QualMatrix): BuiltHeader[] {
  const heads: BuiltHeader[] = [
    { key: "worker_name", label: "Trabalhador", getter: (r) => r.worker_name },
    { key: "cpf", label: "CPF", getter: (r) => r.cpf ?? r.cpf_masked ?? "" },
  ];
  for (const col of matrix.columns) {
    const label = col.name;
    heads.push({
      key: `${col.document_type_id}_status`,
      label: `${label} Status`,
      getter: (r) => {
        const cell = r.cells.find((c) => c.document_type_id === col.document_type_id);
        return cell ? STATUS_PT[cell.status] : "";
      },
    });
    heads.push({
      key: `${col.document_type_id}_expiry`,
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
  ws.columns = heads.map((h) => ({ header: h.label, key: h.key, width: 22 }));
  ws.getRow(1).font = { bold: true };
  for (const r of matrix.items) {
    const row: Record<string, string> = {};
    heads.forEach((h) => { row[h.key] = h.getter(r); });
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