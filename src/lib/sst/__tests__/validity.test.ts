import { describe, expect, it } from "vitest";
import { computeCertificateExpiry, computeEffectiveExpiry } from "../validity";

describe("computeCertificateExpiry", () => {
  it("calcula issued_at + default_validity_days", () => {
    expect(
      computeCertificateExpiry({
        issuedAt: "2026-01-01",
        hasExpiry: true,
        defaultValidityDays: 730,
      }),
    ).toEqual({
      expiresAt: "2028-01-01",
      source: "document_type_default",
      validityDaysUsed: 730,
    });
  });

  it("retorna none quando não há regra padrão", () => {
    expect(
      computeCertificateExpiry({
        issuedAt: "2026-01-01",
        hasExpiry: true,
        defaultValidityDays: null,
      }),
    ).toEqual({ expiresAt: null, source: "none", validityDaysUsed: null });
  });

  it("preserva vencimento explícito e marca source=explicit", () => {
    const r = computeCertificateExpiry({
      issuedAt: "2026-01-01",
      hasExpiry: true,
      defaultValidityDays: 730,
      manualExpiry: "2026-06-30",
    });
    expect(r.expiresAt).toBe("2026-06-30");
    expect(r.source).toBe("explicit");
  });

  it("recalcula ao mudar a data de realização", () => {
    const a = computeCertificateExpiry({
      issuedAt: "2026-01-01",
      hasExpiry: true,
      defaultValidityDays: 365,
    });
    const b = computeCertificateExpiry({
      issuedAt: "2026-02-01",
      hasExpiry: true,
      defaultValidityDays: 365,
    });
    expect(a.expiresAt).not.toBe(b.expiresAt);
  });

  it("hasExpiry=false devolve null", () => {
    expect(
      computeCertificateExpiry({
        issuedAt: "2026-01-01",
        hasExpiry: false,
        defaultValidityDays: 730,
      }).expiresAt,
    ).toBeNull();
  });
});

describe("computeEffectiveExpiry — precedência de cargo", () => {
  it("override do cargo mais restritivo prevalece", () => {
    const r = computeEffectiveExpiry({
      certificateExpiry: "2027-01-01",
      issuedAt: "2026-01-01",
      validityDaysOverride: 180,
    });
    // 2026-01-01 + 180 dias = 2026-06-30
    expect(r.effectiveExpiry).toBe("2026-06-30");
    expect(r.source).toBe("role_override");
  });

  it("certificado mais restritivo que override prevalece", () => {
    const r = computeEffectiveExpiry({
      certificateExpiry: "2026-03-01",
      issuedAt: "2026-01-01",
      validityDaysOverride: 730,
    });
    expect(r.effectiveExpiry).toBe("2026-03-01");
    expect(r.source).toBe("certificate");
  });

  it("sem override, mantém certificado", () => {
    const r = computeEffectiveExpiry({
      certificateExpiry: "2026-12-31",
      issuedAt: "2026-01-01",
      validityDaysOverride: null,
    });
    expect(r.source).toBe("certificate");
  });

  it("sem certificado nem override, retorna none", () => {
    const r = computeEffectiveExpiry({
      certificateExpiry: null,
      issuedAt: null,
      validityDaysOverride: null,
    });
    expect(r.effectiveExpiry).toBeNull();
    expect(r.source).toBe("none");
  });
});