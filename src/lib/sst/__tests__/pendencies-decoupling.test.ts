// Regressão do desacoplamento Worker 1 → 0..N vínculos (Entrega UX/exportação).
// Cobre cenários D, E, F, G, J: ausência de vínculo não é pendência nem órfão,
// qualificação válida sem vínculo continua válida, órfão só existe para FK
// quebrada / worker deletado / document_type ausente, XLSX exibe vínculo
// apenas como contexto e fixtures E2E são detectadas independentemente.

import { describe, it, expect } from "vitest";
import type {
  SstWorkerRow, SstCurrentRow,
} from "@/hooks/useSstQualifications";
import {
  NO_CURRENT_LINK_LABEL, resolveCurrentLinkLabel,
} from "@/lib/sst/pendencies-export";
import { collectPendencies, groupPendenciesByWorker } from "@/lib/sst/export";
import { isTestDataWorker } from "@/lib/sst/test-data";

function q(over: Partial<SstCurrentRow> = {}): SstCurrentRow {
  return {
    id: "q1", worker_id: "w1", nr_code: "NR10", chain_key: "w1:NR10",
    training_type: null, issued_at: "2025-01-01", expires_at: "2099-01-01",
    workload_hours: null, provider_name: null, instructor_name: null,
    document_url: "https://example/doc.pdf",
    document_status: "ok", validity_status: "has_expiry",
    source_type: "manual", revision_type: "initial", revision_reason: null,
    document_type_id: "dt-nr10", employment_link_document_id: null,
    link_group_worker_id: null, link_group_id: null, event_id: null,
    company_id: null, notes: null, expiration_status: "valid",
    ...over,
  };
}
function w(id: string, name: string, quals: SstCurrentRow[] = []): SstWorkerRow {
  return { worker_id: id, full_name: name, nickname: null, cpf: null, qualifications: quals.map((x) => ({ ...x, worker_id: id })) };
}

describe("desacoplamento worker × vínculo — rótulo neutro (D, G)", () => {
  it("rótulo canônico é neutro, sem conotação de erro", () => {
    expect(NO_CURRENT_LINK_LABEL).toBe("Disponível — sem vínculo atual");
    expect(NO_CURRENT_LINK_LABEL).not.toMatch(/pend[eê]ncia|erro|falta|obrigat|órf/i);
  });

  it("resolveCurrentLinkLabel([]) e (undefined) retornam o rótulo neutro", () => {
    expect(resolveCurrentLinkLabel([])).toBe(NO_CURRENT_LINK_LABEL);
    expect(resolveCurrentLinkLabel(undefined)).toBe(NO_CURRENT_LINK_LABEL);
  });

  it("resolveCurrentLinkLabel agrega múltiplos vínculos como contexto", () => {
    const out = resolveCurrentLinkLabel(["EvA · Cargo1", "EvB · Cargo2", "EvC · Cargo3"]);
    expect(out).toContain("EvA · Cargo1");
    expect(out).toContain("EvB · Cargo2");
    expect(out).toContain("+1");
  });
});

describe("collectPendencies — pessoa sem vínculo (D, E)", () => {
  it("D. worker sem vínculo com qualificações válidas NÃO gera pendência", () => {
    const workers = [w("w1", "Maria Silva", [q({ id: "q1", expiration_status: "valid", document_status: "ok" })])];
    expect(collectPendencies(workers)).toEqual([]);
  });

  it("E. qualificação válida de pessoa sem vínculo permanece válida (rank>=99 -> excluída)", () => {
    const workers = [w("w1", "João", [q({ expiration_status: "valid", document_status: "ok" })])];
    const groups = groupPendenciesByWorker(collectPendencies(workers));
    expect(groups).toHaveLength(0);
  });

  it("D-bis. pendência real de worker sem vínculo aparece (vencida) — vínculo não é o critério", () => {
    const workers = [w("w1", "Ana", [q({ expiration_status: "expired", expires_at: "2020-01-01" })])];
    const rows = collectPendencies(workers);
    expect(rows).toHaveLength(1);
    expect(rows[0].rank).toBe(1); // vencida
  });

  it("B. worker com múltiplas quals aparece 1 vez em groupPendenciesByWorker", () => {
    const workers = [
      w("w1", "Ana", [
        q({ id: "a", nr_code: "NR10", expiration_status: "expired", expires_at: "2020-01-01" }),
        q({ id: "b", nr_code: "NR35", expiration_status: "expiring_soon", expires_at: "2099-01-01" }),
      ]),
    ];
    const groups = groupPendenciesByWorker(collectPendencies(workers));
    expect(groups).toHaveLength(1);
    expect(groups[0].pendencies).toHaveLength(2);
  });
});

describe("órfãos — definição canônica (F)", () => {
  // O classificador vive em useSstQualifications; aqui documentamos o
  // contrato: pessoa ativa SEM vínculo nunca deve ser marcada como órfã.
  it("F. worker vivo sem vínculo NÃO é fixture de teste automaticamente", () => {
    const worker = w("w1", "Maria Silva");
    expect(isTestDataWorker(worker)).toBe(false);
  });
});

describe("fixtures E2E vs. pessoas reais sem vínculo (J)", () => {
  it("J. fixture E2E é detectada; pessoa real sem vínculo não é confundida", () => {
    expect(isTestDataWorker(w("x", "E2E T13 curl"))).toBe(true);
    expect(isTestDataWorker(w("y", "Maria Silva"))).toBe(false);
  });
});