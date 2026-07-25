// Heurística de detecção de fixtures E2E na base operacional.
// Enquanto não existe um campo canônico `is_test_data` / `record_origin` no
// schema, marcamos aqui os padrões observados em produção — sempre exigindo
// evidência forte (prefixo E2E, marcador de suite Q024x, "curl" isolado,
// ou nomes gerados como "-l1mk" / hashes curtos). Nenhum registro é
// modificado; a marcação existe só para exibição e exportação.

import type { SstWorkerRow } from "@/hooks/useSstQualifications";

const STRONG_MARKERS: RegExp[] = [
  /\bE2E\b/i,
  /\bQ0\d{2}[A-Z]?\b/i,     // Q024, Q024B, Q021...
  /\bcurl\b/i,               // "E2E T13 curl"
  /-[a-z0-9]{6,}-[a-z0-9]{3,}\b/i, // -mrzjyyb9-l1mk
  /^T\d{1,3}(\s|$)/,          // "T13 ..."
];

export function isTestDataName(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.trim();
  if (!s) return false;
  return STRONG_MARKERS.some((rx) => rx.test(s));
}

export function isTestDataWorker(w: Pick<SstWorkerRow, "full_name" | "nickname">): boolean {
  return isTestDataName(w.full_name) || isTestDataName(w.nickname);
}

export interface PartitionedWorkers {
  operational: SstWorkerRow[];
  test: SstWorkerRow[];
}

export function partitionByTestData(workers: SstWorkerRow[]): PartitionedWorkers {
  const operational: SstWorkerRow[] = [];
  const test: SstWorkerRow[] = [];
  for (const w of workers) (isTestDataWorker(w) ? test : operational).push(w);
  return { operational, test };
}