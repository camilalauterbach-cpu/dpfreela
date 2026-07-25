import { describe, it, expect } from "vitest";
import {
  humanizeValidity,
  isValidityConfigured,
  projectDocumentExpiry,
  validityToDays,
} from "../document-validity";

describe("validityToDays", () => {
  it("converte dia/mês/ano com proporções canônicas", () => {
    expect(validityToDays(10, "day")).toBe(10);
    expect(validityToDays(2, "month")).toBe(60);
    expect(validityToDays(1, "year")).toBe(365);
    expect(validityToDays(2, "year")).toBe(730);
  });
  it("rejeita zero e negativos", () => {
    expect(() => validityToDays(0, "day")).toThrow();
    expect(() => validityToDays(-1, "year")).toThrow();
  });
});

describe("humanizeValidity", () => {
  it("Sem vencimento", () => {
    expect(humanizeValidity({ mode: "no_expiry", value: null, unit: null })).toBe("Sem vencimento");
  });
  it("1 ano usa singular", () => {
    expect(humanizeValidity({ mode: "fixed_duration", value: 1, unit: "year" })).toBe("1 ano");
  });
  it("2 anos usa plural", () => {
    expect(humanizeValidity({ mode: "fixed_duration", value: 2, unit: "year" })).toBe("2 anos");
  });
  it("valor personalizado em meses", () => {
    expect(humanizeValidity({ mode: "fixed_duration", value: 18, unit: "month" })).toBe("18 meses");
  });
  it("Não configurado quando o tipo ainda não foi parametrizado", () => {
    expect(humanizeValidity({ mode: null, value: null, unit: null })).toBe("Não configurado");
  });
  it("cai no legado (default_validity_days) quando canônico ausente", () => {
    expect(
      humanizeValidity({
        mode: "fixed_duration",
        value: null,
        unit: null,
        defaultValidityDays: 365,
        hasExpiration: true,
      }),
    ).toBe("365 dias");
  });
});

describe("isValidityConfigured", () => {
  it("sem vencimento é configuração válida", () => {
    expect(isValidityConfigured({ mode: "no_expiry", value: null, unit: null })).toBe(true);
  });
  it("com vencimento exige value+unit ou legado positivo", () => {
    expect(isValidityConfigured({ mode: "fixed_duration", value: 1, unit: "year" })).toBe(true);
    expect(isValidityConfigured({ mode: "fixed_duration", value: null, unit: null })).toBe(false);
    expect(isValidityConfigured({ mode: "fixed_duration", value: null, unit: null, defaultValidityDays: 730, hasExpiration: true })).toBe(true);
  });
  it("indefinido não é considerado configurado", () => {
    expect(isValidityConfigured({ mode: null, value: null, unit: null })).toBe(false);
  });
});

describe("projectDocumentExpiry", () => {
  it("Sem vencimento não calcula data", () => {
    expect(projectDocumentExpiry("2026-01-15", { mode: "no_expiry", value: null, unit: null })).toBeNull();
  });
  it("1 ano soma calendário preservando mês/dia", () => {
    expect(
      projectDocumentExpiry("2026-02-10", { mode: "fixed_duration", value: 1, unit: "year" }),
    ).toBe("2027-02-10");
  });
  it("2 anos", () => {
    expect(
      projectDocumentExpiry("2026-03-01", { mode: "fixed_duration", value: 2, unit: "year" }),
    ).toBe("2028-03-01");
  });
  it("meses preservam o dia", () => {
    expect(
      projectDocumentExpiry("2026-01-15", { mode: "fixed_duration", value: 6, unit: "month" }),
    ).toBe("2026-07-15");
  });
  it("dias soma exata", () => {
    expect(
      projectDocumentExpiry("2026-01-01", { mode: "fixed_duration", value: 30, unit: "day" }),
    ).toBe("2026-01-31");
  });
  it("recalcula ao mudar a data do fato", () => {
    const rule = { mode: "fixed_duration" as const, value: 1, unit: "year" as const };
    const a = projectDocumentExpiry("2026-01-01", rule);
    const b = projectDocumentExpiry("2026-02-01", rule);
    expect(a).not.toBe(b);
  });
  it("usa fallback legado default_validity_days quando canônico não presente", () => {
    expect(
      projectDocumentExpiry("2026-01-01", {
        mode: "fixed_duration",
        value: null,
        unit: null,
        defaultValidityDays: 730,
        hasExpiration: true,
      }),
    ).toBe("2027-12-31");
  });
});
