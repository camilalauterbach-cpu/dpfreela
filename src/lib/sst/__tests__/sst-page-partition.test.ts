import { describe, it, expect } from "vitest";
import { partitionByTestData } from "@/lib/sst/test-data";
import type { SstWorkerRow, SstCurrentRow } from "@/hooks/useSstQualifications";

// Q-027: Regressão da partição aplicada em /sst. Reproduz a lógica de contagem
// derivada do componente Sst.tsx para garantir que fixtures não contaminem
// cards, totais e exportações por padrão, e que o switch admin inclua tudo.

function q(over: Partial<SstCurrentRow> = {}): SstCurrentRow {
  return {
    id: crypto.randomUUID(), worker_id: "w", nr_code: "NR-06", chain_key: "w|NR-06",
    training_type: null, issued_at: "2026-01-01", expires_at: null, workload_hours: null,
    provider_name: null, instructor_name: null, document_url: null,
    document_status: "ok", validity_status: "no_expiry", source_type: "manual",
    revision_type: "initial", revision_reason: null, document_type_id: null,
    employment_link_document_id: null, link_group_worker_id: null,
    link_group_id: null, event_id: null, company_id: null, notes: null,
    expiration_status: "no_expiry", ...over,
  };
}
function w(id: string, name: string, quals: SstCurrentRow[]): SstWorkerRow {
  return { worker_id: id, full_name: name, nickname: null, cpf: null, qualifications: quals.map((x) => ({ ...x, worker_id: id })) };
}

function derivedCounts(workers: SstWorkerRow[]) {
  const wSet = new Set<string>();
  let expired = 0, expiring = 0, pending = 0;
  for (const w of workers) {
    wSet.add(w.worker_id);
    for (const q of w.qualifications) {
      if (q.expiration_status === "expired") expired++;
      else if (q.expiration_status === "expiring_soon") expiring++;
      if (q.document_status === "pending") pending++;
    }
  }
  return { totalWorkers: wSet.size, expired, expiring, pending };
}

const dataset: SstWorkerRow[] = [
  w("r1", "Maria Silva", [q({ expiration_status: "expired", document_status: "pending" })]),
  w("r2", "João Pereira", [q({ expiration_status: "expiring_soon" })]),
  w("r3", "Curling da Costa", [q({ document_status: "pending" })]), // nome parecido, não é fixture
  w("t1", "E2E Q024B Q024B-mrzjyyb9-l1mk", [q({ expiration_status: "expired" }), q({ document_status: "pending" })]),
  w("t2", "E2E T13 curl", [q({ expiration_status: "expiring_soon" })]),
];

describe("Sst — partição canônica de fixtures", () => {
  it("por padrão exclui fixtures dos totais e da lista", () => {
    const { operational, test } = partitionByTestData(dataset);
    expect(test).toHaveLength(2);
    expect(operational.map((w) => w.full_name).sort()).toEqual([
      "Curling da Costa", "João Pereira", "Maria Silva",
    ]);
    const c = derivedCounts(operational);
    expect(c).toEqual({ totalWorkers: 3, expired: 1, expiring: 1, pending: 2 });
  });

  it("admin com switch ligado inclui fixtures", () => {
    const c = derivedCounts(dataset);
    expect(c).toEqual({ totalWorkers: 5, expired: 2, expiring: 2, pending: 3 });
  });

  it("nomes reais com sufixos parecidos não são filtrados", () => {
    const { operational } = partitionByTestData(dataset);
    expect(operational.some((w) => w.full_name === "Curling da Costa")).toBe(true);
  });
});