import { describe, it, expect } from "vitest";
import {
  flattenWorkers, buildCsv, collectPendencies, priorityRank, daysRemaining,
} from "@/lib/sst/export";
import type { SstCurrentRow, SstWorkerRow } from "@/hooks/useSstQualifications";

function q(over: Partial<SstCurrentRow>): SstCurrentRow {
  return {
    id: "q1", worker_id: "w1", nr_code: "NR-06", chain_key: "w1|NR-06",
    training_type: null, issued_at: "2026-01-01", expires_at: null,
    workload_hours: null, provider_name: null, instructor_name: null,
    document_url: null, document_status: "ok", validity_status: "no_expiry",
    source_type: "manual", revision_type: "initial",
    employment_link_document_id: null, link_group_worker_id: null,
    link_group_id: null, event_id: null, company_id: null, notes: null,
    expiration_status: "no_expiry", ...over,
  };
}

function w(qs: SstCurrentRow[]): SstWorkerRow {
  return { worker_id: "w1", full_name: "Maria Silva", nickname: null, cpf: "12345678901", qualifications: qs };
}

describe("flattenWorkers", () => {
  it("expande uma linha por qualificação", () => {
    const rows = flattenWorkers([w([q({ nr_code: "NR-35" }), q({ id: "q2", nr_code: "NR-06" })])]);
    expect(rows).toHaveLength(2);
    expect(rows[0].nr_code).toBe("NR-06");
    expect(rows[1].nr_code).toBe("NR-35");
    expect(rows[0].worker_name).toBe("Maria Silva");
  });
});

describe("buildCsv", () => {
  it("gera cabeçalho com BOM e separador ;", () => {
    const csv = buildCsv(flattenWorkers([w([q({})])]));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\n")[0]).toContain("Trabalhador;");
  });
  it("escapa aspas e quebras", () => {
    const csv = buildCsv(flattenWorkers([w([q({ notes: 'com; ponto e "aspas"' })])]));
    expect(csv).toContain('"com; ponto e ""aspas"""');
  });
});

describe("priorityRank/collectPendencies", () => {
  it("prioriza vencido > rejeitado > vencendo", () => {
    expect(priorityRank(q({ expiration_status: "expired" }))).toBe(1);
    expect(priorityRank(q({ document_status: "rejected" }))).toBe(2);
    expect(priorityRank(q({ expiration_status: "expiring_soon", expires_at: futureDays(5) }))).toBe(3);
    expect(priorityRank(q({ expiration_status: "expiring_soon", expires_at: futureDays(12) }))).toBe(4);
    expect(priorityRank(q({ expiration_status: "expiring_soon", expires_at: futureDays(25) }))).toBe(5);
    expect(priorityRank(q({ document_status: "pending" }))).toBe(6);
  });
  it("ordena pendências por rank e depois por dias restantes", () => {
    const ws = w([
      q({ id: "a", expiration_status: "expiring_soon", expires_at: futureDays(20) }),
      q({ id: "b", expiration_status: "expired" }),
      q({ id: "c", expiration_status: "expiring_soon", expires_at: futureDays(3) }),
    ]);
    const p = collectPendencies([ws]);
    expect(p.map((x) => x.q.id)).toEqual(["b", "c", "a"]);
  });
  it("ignora qualificações saudáveis", () => {
    const p = collectPendencies([w([q({ expiration_status: "no_expiry", document_status: "ok" })])]);
    expect(p).toHaveLength(0);
  });
});

describe("daysRemaining", () => {
  it("retorna null quando não há data", () => {
    expect(daysRemaining(null)).toBeNull();
  });
  it("calcula dias positivos e negativos", () => {
    expect(daysRemaining(futureDays(10))).toBeGreaterThanOrEqual(9);
    expect(daysRemaining(futureDays(-5))).toBeLessThanOrEqual(-4);
  });
});

function futureDays(n: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}