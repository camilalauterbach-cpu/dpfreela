import { describe, it, expect } from "vitest";
import { isTestDataName, isTestDataWorker, partitionByTestData } from "@/lib/sst/test-data";
import type { SstWorkerRow } from "@/hooks/useSstQualifications";

function mk(full: string, nickname: string | null = null): SstWorkerRow {
  return { worker_id: "w", full_name: full, nickname, cpf: null, qualifications: [] };
}

describe("isTestDataName", () => {
  it("detecta prefixos E2E e códigos de suíte", () => {
    expect(isTestDataName("E2E T13 curl")).toBe(true);
    expect(isTestDataName("E2E Q024B Q024B-mrzjyyb9-l1mk")).toBe(true);
    expect(isTestDataName("T15 alguma coisa")).toBe(true);
  });
  it("não marca nomes reais parecidos", () => {
    expect(isTestDataName("Maria Silva")).toBe(false);
    expect(isTestDataName("Tiago Andrade")).toBe(false);
    expect(isTestDataName("Curling da Costa")).toBe(false); // 'curl' não é palavra isolada
    expect(isTestDataName(null)).toBe(false);
    expect(isTestDataName("")).toBe(false);
  });
});

describe("partitionByTestData", () => {
  it("separa fixtures da operação", () => {
    const workers = [mk("Maria Silva"), mk("E2E Test", "e2e"), mk("João"), mk("T8 João")];
    const { operational, test } = partitionByTestData(workers);
    expect(operational.map((w) => w.full_name)).toEqual(["Maria Silva", "João"]);
    expect(test.map((w) => w.full_name)).toEqual(["E2E Test", "T8 João"]);
  });
});

describe("isTestDataWorker", () => {
  it("cobre apelidos suspeitos", () => {
    expect(isTestDataWorker(mk("Maria", "E2E-alias"))).toBe(true);
    expect(isTestDataWorker(mk("Maria", null))).toBe(false);
  });
});