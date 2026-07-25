// Fonte única de apresentação/conversão da validade padrão por tipo documental.
// Espelha o contrato canônico em `document_types` (validity_mode/value/unit) e a
// função SQL `calculate_document_expiry`. Todas as telas devem consumir estes
// helpers para evitar múltiplas fontes de verdade.

export type ValidityMode = "no_expiry" | "fixed_duration" | "explicit_date";
export type ValidityUnit = "day" | "month" | "year";

export interface ValidityRule {
  mode: ValidityMode | null;
  value: number | null;
  unit: ValidityUnit | null;
  /** Legacy — mantido em sincronia pela RPC set_document_type_validity. */
  defaultValidityDays?: number | null;
  /** Legacy — mantido em sincronia pela RPC set_document_type_validity. */
  hasExpiration?: boolean | null;
}

const UNIT_LABEL_SINGULAR: Record<ValidityUnit, string> = {
  day: "dia",
  month: "mês",
  year: "ano",
};
const UNIT_LABEL_PLURAL: Record<ValidityUnit, string> = {
  day: "dias",
  month: "meses",
  year: "anos",
};

/**
 * Converte (value, unit) em dias equivalentes, usando as mesmas
 * proporções aplicadas em `set_document_type_validity` (mês=30, ano=365).
 */
export function validityToDays(value: number, unit: ValidityUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("validity_value_must_be_positive");
  }
  switch (unit) {
    case "day":
      return Math.round(value);
    case "month":
      return Math.round(value) * 30;
    case "year":
      return Math.round(value) * 365;
  }
}

/** Descreve a regra em português para exibição na UI. */
export function humanizeValidity(rule: ValidityRule): string {
  const mode = rule.mode
    ?? (rule.hasExpiration ? "fixed_duration" : rule.hasExpiration === false ? "no_expiry" : null);
  if (mode === "no_expiry") return "Sem vencimento";
  if (mode === "explicit_date") return "Data explícita no documento";
  if (mode === "fixed_duration") {
    const v = rule.value ?? null;
    const u = rule.unit ?? null;
    if (v && u) {
      const label = v === 1 ? UNIT_LABEL_SINGULAR[u] : UNIT_LABEL_PLURAL[u];
      return `${v} ${label}`;
    }
    // Fallback via legado
    const days = rule.defaultValidityDays;
    if (days && days > 0) return `${days} dias`;
  }
  return "Não configurado";
}

/**
 * Verifica se a regra é suficiente para calcular vencimento a partir da
 * data de emissão. Utilizado por formulários de novo certificado/documento.
 */
export function isValidityConfigured(rule: ValidityRule): boolean {
  const mode = rule.mode
    ?? (rule.hasExpiration ? "fixed_duration" : rule.hasExpiration === false ? "no_expiry" : null);
  if (mode === "no_expiry") return true;
  if (mode === "fixed_duration") {
    return !!(rule.value && rule.value > 0 && rule.unit)
      || !!(rule.defaultValidityDays && rule.defaultValidityDays > 0);
  }
  return false;
}

/**
 * Calcula, no cliente, o vencimento previsto de um novo documento a partir
 * da data do fato (emissão/realização) e da regra do tipo. Retorna null quando
 * o tipo é `no_expiry` ou a regra ainda não foi configurada.
 *
 * A conta espelha `public.calculate_document_expiry` em modo `fixed_duration`:
 * - `day`  → soma exata em dias
 * - `month`→ soma em meses de calendário (preserva o dia)
 * - `year` → soma em anos de calendário (preserva mês/dia)
 */
export function projectDocumentExpiry(
  issuedAtIso: string,
  rule: ValidityRule,
): string | null {
  const mode = rule.mode
    ?? (rule.hasExpiration ? "fixed_duration" : rule.hasExpiration === false ? "no_expiry" : null);
  if (mode !== "fixed_duration") return null;
  const [y, m, d] = issuedAtIso.split("-").map(Number);
  if (!y || !m || !d) return null;

  if (rule.value && rule.unit) {
    const v = rule.value;
    if (rule.unit === "day") {
      const t = Date.UTC(y, m - 1, d) + v * 86_400_000;
      const dt = new Date(t);
      return isoUtc(dt);
    }
    if (rule.unit === "month") {
      const dt = new Date(Date.UTC(y, m - 1 + v, d));
      return isoUtc(dt);
    }
    if (rule.unit === "year") {
      const dt = new Date(Date.UTC(y + v, m - 1, d));
      return isoUtc(dt);
    }
  }
  // Fallback legado
  if (rule.defaultValidityDays && rule.defaultValidityDays > 0) {
    const t = Date.UTC(y, m - 1, d) + rule.defaultValidityDays * 86_400_000;
    return isoUtc(new Date(t));
  }
  return null;
}

function isoUtc(dt: Date): string {
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export const VALIDITY_UNIT_OPTIONS: { value: ValidityUnit; label: string }[] = [
  { value: "day", label: "Dias" },
  { value: "month", label: "Meses" },
  { value: "year", label: "Anos" },
];

/** Presets rápidos frequentes (1 ano, 2 anos) usados no formulário. */
export const VALIDITY_PRESETS: {
  key: string;
  label: string;
  mode: ValidityMode;
  value: number | null;
  unit: ValidityUnit | null;
}[] = [
  { key: "none", label: "Sem vencimento", mode: "no_expiry", value: null, unit: null },
  { key: "1y", label: "1 ano", mode: "fixed_duration", value: 1, unit: "year" },
  { key: "2y", label: "2 anos", mode: "fixed_duration", value: 2, unit: "year" },
  { key: "custom", label: "Personalizado", mode: "fixed_duration", value: null, unit: null },
];
