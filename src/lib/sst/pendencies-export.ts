// Exportação operacional de Pendências SST em .xlsx real (ExcelJS).
// 4 abas: Resumo, Pendências SST, Órfãos e legados, Dados de teste.
// Recebe os dados já filtrados pela tela — não faz novas consultas.

import type {
  SstOrphanRow, SstWorkerRow, SstCurrentRow,
} from "@/hooks/useSstQualifications";
import {
  collectPendencies, daysRemaining, DOC_LABEL_PT, EXP_LABEL_PT,
  type PendencyRow,
} from "@/lib/sst/export";
import { isTestDataWorker } from "@/lib/sst/test-data";
import { supabase } from "@/integrations/supabase/client";

/**
 * Busca uma etiqueta informativa do(s) vínculo(s) ativo(s) por trabalhador.
 * NUNCA gera pendência — ausência de vínculo é rotulada como
 * "Disponível — sem vínculo atual" (estado neutro).
 */
async function fetchCurrentLinksByWorker(workerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (workerIds.length === 0) return out;
  const { data, error } = await (supabase as any)
    .from("link_group_workers")
    .select("worker_id, job_roles:job_role_id(name), link_groups!inner(group_name, events(name))")
    .in("worker_id", workerIds)
    .is("deleted_at", null);
  if (error) return out;
  const byWorker = new Map<string, string[]>();
  for (const row of (data || []) as any[]) {
    const evt = row.link_groups?.events?.name ?? row.link_groups?.group_name ?? "—";
    const role = row.job_roles?.name ?? "sem cargo";
    const label = `${evt} · ${role}`;
    const arr = byWorker.get(row.worker_id) || [];
    if (!arr.includes(label)) arr.push(label);
    byWorker.set(row.worker_id, arr);
  }
  for (const [wid, labels] of byWorker) {
    const head = labels.slice(0, 2).join("  |  ");
    out.set(wid, labels.length > 2 ? `${head} +${labels.length - 2}` : head);
  }
  return out;
}

function fmtBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function rankLabel(rank: number): string {
  return ({
    1: "Vencida", 2: "Rejeitada", 3: "Vence em ≤7d", 4: "Vence em ≤15d",
    5: "Vence em ≤30d", 6: "Documento pendente", 7: "Sem comprovante",
    8: "Validade desconhecida",
  } as Record<number, string>)[rank] ?? "—";
}
function actionFor(rank: number): string {
  return ({
    1: "Renovar certificado", 2: "Substituir documento rejeitado",
    3: "Renovar antes do vencimento", 4: "Programar renovação",
    5: "Programar renovação", 6: "Concluir análise do documento",
    7: "Anexar comprovante", 8: "Confirmar validade",
  } as Record<number, string>)[rank] ?? "";
}

export interface PendenciesExportFilters {
  search?: string;
  category?: string;
  nr?: string;
  includeTestData?: boolean;
}

export interface PendenciesExportInput {
  filters: PendenciesExportFilters;
  /** Trabalhadores operacionais (já sem dados de teste, se o toggle estiver desligado). */
  operationalWorkers: SstWorkerRow[];
  /** Pendências filtradas pela tela — se vazio, será derivado dos workers. */
  filteredPendencies?: PendencyRow[];
  testWorkers: SstWorkerRow[];
  orphans: SstOrphanRow[];
  workerLinkBase?: string;
}

function siteBase(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function buildResumo(input: PendenciesExportInput, pendencies: PendencyRow[]) {
  const totals = { expired: 0, rejected: 0, expiring: 0, pending: 0, no_doc: 0, unknown: 0 };
  const uniqWorkers = new Set<string>();
  for (const p of pendencies) {
    uniqWorkers.add(p.worker.worker_id);
    if (p.rank === 1) totals.expired++;
    else if (p.rank === 2) totals.rejected++;
    else if (p.rank <= 5) totals.expiring++;
    else if (p.rank === 6) totals.pending++;
    else if (p.rank === 7) totals.no_doc++;
    else if (p.rank === 8) totals.unknown++;
  }
  const f = input.filters;
  const rows: [string, string | number][] = [
    ["Gerado em", new Date().toLocaleString("pt-BR")],
    ["Filtro — busca", f.search || "(nenhum)"],
    ["Filtro — categoria", f.category || "(todas)"],
    ["Filtro — NR", f.nr || "(todas)"],
    ["Filtro — inclui dados de teste?", f.includeTestData ? "Sim" : "Não"],
    ["", ""],
    ["Trabalhadores com pendência", uniqWorkers.size],
    ["Total de pendências", pendencies.length],
    ["  · Vencidas", totals.expired],
    ["  · Rejeitadas", totals.rejected],
    ["  · Vencendo (≤30d)", totals.expiring],
    ["  · Documento pendente", totals.pending],
    ["  · Sem comprovante", totals.no_doc],
    ["  · Validade desconhecida", totals.unknown],
    ["", ""],
    ["Órfãos / legados detectados", input.orphans.length],
    ["Dados de teste detectados (trabalhadores)", input.testWorkers.length],
  ];
  return rows;
}

function pendencyRowValues(p: PendencyRow, base: string, linkLabel: string) {
  const q = p.q;
  const dr = daysRemaining(q.expires_at);
  return {
    worker_name: p.worker.full_name,
    cpf: p.worker.cpf ?? "",
    worker_id: p.worker.worker_id,
    nr_code: q.nr_code,
    training_type: q.training_type ?? "",
    situation: rankLabel(p.rank),
    reason: `${DOC_LABEL_PT[q.document_status]} · ${EXP_LABEL_PT[q.expiration_status]}`,
    doc_status: DOC_LABEL_PT[q.document_status],
    issued_at: fmtBR(q.issued_at),
    expires_at: fmtBR(q.expires_at),
    days: dr == null ? "" : dr,
    has_file: q.document_url ? "Sim" : "Não",
    action: actionFor(p.rank),
    current_link: linkLabel,
    worker_link: base ? `${base}/workers/${p.worker.worker_id}` : "",
    evaluated_at: new Date().toLocaleString("pt-BR"),
  };
}

function orphanRowValues(o: SstOrphanRow) {
  const REASON_LABEL: Record<SstOrphanRow["reason"], string> = {
    worker_not_found: "worker_id não localiza pessoa",
    worker_deleted: "Trabalhador excluído (deleted_at)",
    missing_document_type: "Qualificação sem tipo documental canônico",
  };
  const ACTION_LABEL: Record<SstOrphanRow["reason"], string> = {
    worker_not_found: "Reassociar trabalhador ou excluir registro",
    worker_deleted: "Reassociar a um trabalhador ativo",
    missing_document_type: "Definir tipo documental canônico",
  };
  const q = o.row;
  return {
    qualification_id: q.id,
    worker_id: q.worker_id,
    nr_code: q.nr_code,
    document_type_id: q.document_type_id ?? "",
    issued_at: fmtBR(q.issued_at),
    expires_at: fmtBR(q.expires_at),
    doc_status: DOC_LABEL_PT[q.document_status],
    reason: REASON_LABEL[o.reason],
    action: ACTION_LABEL[o.reason],
  };
}

function testWorkerRowValues(w: SstWorkerRow) {
  const p = collectPendencies([w]);
  return {
    worker_name: w.full_name,
    nickname: w.nickname ?? "",
    cpf: w.cpf ?? "",
    worker_id: w.worker_id,
    qualifications: w.qualifications.length,
    pendencies: p.length,
  };
}

export async function exportPendenciesXlsx(input: PendenciesExportInput): Promise<number> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPfreela";
  wb.created = new Date();

  const pendencies = input.filteredPendencies ?? collectPendencies(input.operationalWorkers);
  const base = siteBase(input.workerLinkBase);
  const workerIds = Array.from(new Set(pendencies.map((p) => p.worker.worker_id)));
  const linksByWorker = await fetchCurrentLinksByWorker(workerIds);

  // --- Aba A: Resumo ---
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [{ width: 44 }, { width: 40 }];
  resumo.mergeCells("A1:B1");
  resumo.getCell("A1").value = "Pendências SST — Relatório operacional";
  resumo.getCell("A1").font = { bold: true, size: 14 };
  resumo.addRow([]);
  for (const r of buildResumo(input, pendencies)) resumo.addRow(r);
  resumo.getColumn(1).font = { bold: false };
  for (let i = 3; i <= resumo.rowCount; i++) resumo.getRow(i).getCell(1).font = { bold: true };

  // --- Aba B: Pendências SST ---
  const HEADERS_B: Array<{ key: string; header: string; width: number }> = [
    { key: "worker_name", header: "Nome oficial", width: 30 },
    { key: "cpf", header: "CPF", width: 15 },
    { key: "worker_id", header: "worker_id", width: 38 },
    { key: "nr_code", header: "NR / Código", width: 12 },
    { key: "training_type", header: "Treinamento", width: 22 },
    { key: "situation", header: "Situação", width: 18 },
    { key: "reason", header: "Motivo da pendência", width: 32 },
    { key: "doc_status", header: "Status do documento", width: 18 },
    { key: "issued_at", header: "Emissão", width: 12 },
    { key: "expires_at", header: "Vencimento", width: 12 },
    { key: "days", header: "Dias p/ vencer", width: 14 },
    { key: "has_file", header: "Arquivo?", width: 10 },
    { key: "action", header: "Ação necessária", width: 30 },
    { key: "current_link", header: "Vínculo atual (informativo)", width: 36 },
    { key: "worker_link", header: "Link do trabalhador", width: 44 },
    { key: "evaluated_at", header: "Avaliado em", width: 20 },
  ];
  const shB = wb.addWorksheet("Pendências SST");
  shB.columns = HEADERS_B;
  shB.getRow(1).font = { bold: true };
  for (const p of pendencies) {
    const link = linksByWorker.get(p.worker.worker_id) || "Disponível — sem vínculo atual";
    shB.addRow(pendencyRowValues(p, base, link));
  }
  shB.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS_B.length } };
  shB.views = [{ state: "frozen", ySplit: 1 }];

  // --- Aba C: Órfãos e legados ---
  const HEADERS_C = [
    { key: "qualification_id", header: "qualification_id", width: 38 },
    { key: "worker_id", header: "worker_id", width: 38 },
    { key: "nr_code", header: "NR", width: 12 },
    { key: "document_type_id", header: "document_type_id", width: 38 },
    { key: "issued_at", header: "Emissão", width: 12 },
    { key: "expires_at", header: "Vencimento", width: 12 },
    { key: "doc_status", header: "Status do documento", width: 18 },
    { key: "reason", header: "Motivo", width: 40 },
    { key: "action", header: "Ação recomendada", width: 40 },
  ];
  const shC = wb.addWorksheet("Órfãos e legados");
  shC.columns = HEADERS_C as any;
  shC.getRow(1).font = { bold: true };
  for (const o of input.orphans) shC.addRow(orphanRowValues(o));
  shC.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS_C.length } };
  shC.views = [{ state: "frozen", ySplit: 1 }];

  // --- Aba D: Dados de teste ---
  const HEADERS_D = [
    { key: "worker_name", header: "Nome (detectado como teste)", width: 40 },
    { key: "nickname", header: "Apelido", width: 20 },
    { key: "cpf", header: "CPF", width: 15 },
    { key: "worker_id", header: "worker_id", width: 38 },
    { key: "qualifications", header: "Qualificações", width: 14 },
    { key: "pendencies", header: "Pendências", width: 14 },
  ];
  const shD = wb.addWorksheet("Dados de teste");
  shD.columns = HEADERS_D as any;
  shD.getRow(1).font = { bold: true };
  for (const w of input.testWorkers) shD.addRow(testWorkerRowValues(w));
  shD.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS_D.length } };
  shD.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pendencias-sst-${stamp()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return pendencies.length;
}