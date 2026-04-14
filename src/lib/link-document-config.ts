// Configuration for per-link document requirements

export interface LinkDocumentConfig {
  operational: string[];   // e.g. ["ficha_epi", "ordem_servico", "aso_vinculo"]
  operational_custom?: string; // free text for "outros operacionais"
  nrs: string[];           // e.g. ["nr_6", "nr_10", "nr_35"]
  nr_custom?: string;      // free text for custom NR
  company: string[];       // e.g. ["apr", "ltcat", "pcmso", "pgr"]
}

export const EMPTY_CONFIG: LinkDocumentConfig = {
  operational: [],
  operational_custom: "",
  nrs: [],
  nr_custom: "",
  company: [],
};

export const OPERATIONAL_OPTIONS = [
  { value: "ficha_epi", label: "Ficha de entrega de EPI" },
  { value: "ordem_servico", label: "Ordem de serviço" },
  { value: "aso_vinculo", label: "ASO do vínculo" },
  { value: "outros_operacionais", label: "Outros operacionais" },
] as const;

export const NR_OPTIONS = [
  { value: "nr_6", label: "NR 6 — EPI" },
  { value: "nr_10", label: "NR 10 — Segurança em Eletricidade" },
  { value: "nr_17", label: "NR 17 — Ergonomia" },
  { value: "nr_18", label: "NR 18 — Construção Civil" },
  { value: "nr_35", label: "NR 35 — Trabalho em Altura" },
] as const;

export const COMPANY_DOC_OPTIONS = [
  { value: "apr", label: "APR — Análise Preliminar de Riscos" },
  { value: "ltcat", label: "LTCAT" },
  { value: "pcmso", label: "PCMSO" },
  { value: "pgr", label: "PGR" },
  { value: "seguro_equipamentos", label: "Seguro de equipamentos" },
  { value: "seguro_responsabilidade", label: "Seguro de responsabilidade civil" },
  { value: "outros_empresa", label: "Outros documentos da empresa" },
] as const;

export function parseConfig(raw: any): LinkDocumentConfig {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CONFIG };
  return {
    operational: Array.isArray(raw.operational) ? raw.operational : [],
    nrs: Array.isArray(raw.nrs) ? raw.nrs : [],
    nr_custom: raw.nr_custom || "",
    company: Array.isArray(raw.company) ? raw.company : [],
  };
}

/** Get all configured categories as a flat list with labels and group */
export function getConfiguredDocs(config: LinkDocumentConfig) {
  const docs: { category: string; label: string; group: "operational" | "nrs" | "company" }[] = [];

  for (const cat of config.operational) {
    const opt = OPERATIONAL_OPTIONS.find((o) => o.value === cat);
    docs.push({ category: cat, label: opt?.label || cat, group: "operational" });
  }

  for (const cat of config.nrs) {
    const opt = NR_OPTIONS.find((o) => o.value === cat);
    docs.push({ category: cat, label: opt?.label || cat, group: "nrs" });
  }

  if (config.nr_custom) {
    docs.push({ category: "nr_custom", label: config.nr_custom, group: "nrs" });
  }

  for (const cat of config.company) {
    const opt = COMPANY_DOC_OPTIONS.find((o) => o.value === cat);
    docs.push({ category: cat, label: opt?.label || cat, group: "company" });
  }

  return docs;
}

/** All label lookups combined */
export function getCategoryLabel(category: string, config?: LinkDocumentConfig): string {
  const allOptions = [...OPERATIONAL_OPTIONS, ...NR_OPTIONS, ...COMPANY_DOC_OPTIONS];
  const found = allOptions.find((o) => o.value === category);
  if (found) return found.label;
  if (category === "nr_custom" && config?.nr_custom) return config.nr_custom;
  return category;
}
