// Fase 1.5 — cálculo puro de vencimento NR e precedência do cargo.
// Trabalha com strings ISO no formato YYYY-MM-DD para evitar erros de fuso horário.

export type ExpirySource = "explicit" | "document_type_default" | "none";

function addDaysIso(iso: string, days: number): string {
  // Interpretação UTC estável — evita saltos por fuso local.
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export interface ExpiryComputation {
  expiresAt: string | null;
  source: ExpirySource;
  validityDaysUsed: number | null;
}

/**
 * Computa a validade de um certificado NR/treinamento sem tocar em regras de cargo.
 *
 * - manualExpiry preserva sempre (source="explicit").
 * - Se hasExpiry e não houver manual, tenta defaultValidityDays do document_type.
 * - Se defaultValidityDays não existir/for inválido, retorna null e source="none".
 */
export function computeCertificateExpiry(input: {
  issuedAt: string | null | undefined;
  hasExpiry: boolean;
  defaultValidityDays: number | null | undefined;
  manualExpiry?: string | null | undefined;
}): ExpiryComputation {
  const { issuedAt, hasExpiry, defaultValidityDays, manualExpiry } = input;
  if (!hasExpiry) {
    return { expiresAt: null, source: "none", validityDaysUsed: null };
  }
  if (manualExpiry) {
    const days = issuedAt
      ? Math.round(
          (Date.parse(`${manualExpiry}T00:00:00Z`) -
            Date.parse(`${issuedAt}T00:00:00Z`)) /
            86_400_000,
        )
      : null;
    return { expiresAt: manualExpiry, source: "explicit", validityDaysUsed: days };
  }
  if (!issuedAt) {
    return { expiresAt: null, source: "none", validityDaysUsed: null };
  }
  const days =
    typeof defaultValidityDays === "number" && defaultValidityDays > 0
      ? defaultValidityDays
      : null;
  if (days == null) {
    return { expiresAt: null, source: "none", validityDaysUsed: null };
  }
  return {
    expiresAt: addDaysIso(issuedAt, days),
    source: "document_type_default",
    validityDaysUsed: days,
  };
}

/**
 * Precedência do cargo: retorna o prazo mais restritivo entre o certificado
 * e o override do cargo. Mantém a mesma semântica do backend em
 * evaluate_link_compliance v3.
 */
export function computeEffectiveExpiry(input: {
  certificateExpiry: string | null;
  issuedAt: string | null;
  validityDaysOverride: number | null;
}): { effectiveExpiry: string | null; roleEffectiveExpiry: string | null; source: "role_override" | "certificate" | "none" } {
  const { certificateExpiry, issuedAt, validityDaysOverride } = input;
  const roleEffectiveExpiry =
    issuedAt && typeof validityDaysOverride === "number" && validityDaysOverride > 0
      ? addDaysIso(issuedAt, validityDaysOverride)
      : null;

  if (certificateExpiry && roleEffectiveExpiry) {
    return roleEffectiveExpiry < certificateExpiry
      ? { effectiveExpiry: roleEffectiveExpiry, roleEffectiveExpiry, source: "role_override" }
      : { effectiveExpiry: certificateExpiry, roleEffectiveExpiry, source: "certificate" };
  }
  if (roleEffectiveExpiry) {
    return { effectiveExpiry: roleEffectiveExpiry, roleEffectiveExpiry, source: "role_override" };
  }
  if (certificateExpiry) {
    return { effectiveExpiry: certificateExpiry, roleEffectiveExpiry: null, source: "certificate" };
  }
  return { effectiveExpiry: null, roleEffectiveExpiry: null, source: "none" };
}