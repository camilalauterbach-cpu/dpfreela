// DP-readiness logic for workers.
//
// IMPORTANT — Canonical source of document completeness:
// The **only** source of truth for "cadastro completo" is the SQL RPC
// `public.evaluate_worker_registration_completion(worker_id)`, which reads
// `document_types.completion_requirement = 'required'` and applies
// `document_is_valid_for_completion` to the current worker_document revision.
// The doc-category arrays below are kept ONLY as presentational grouping and
// label fallbacks. They MUST NOT drive completeness decisions.

export const REQUIRED_FIELDS = [
  "full_name", "nickname", "cpf", "birth_date", "gender", "race_color",
  "nationality", "birth_country", "mother_name", "rg", "rg_issuer",
  "rg_state", "phone_main", "address", "city", "state", "zip_code",
] as const;

export const RECOMMENDED_FIELDS = [
  "social_name", "father_name", "education_level", "nis_pis",
  "ctps_number", "ctps_series", "ctps_state", "email",
] as const;

/** @deprecated Presentational grouping only — not the source of required truth.
 *  Use `document_types.completion_requirement === 'required'` from the DB. */
export const REQUIRED_DOC_CATEGORIES = [
  "cpf", "rg", "proof_of_address", "photo", "bank_document",
] as const;

/** @deprecated Presentational grouping only — see note on REQUIRED_DOC_CATEGORIES. */
export const CONDITIONAL_DOC_CATEGORIES = [
  "ctps", "nis_pis_proof", "voter_id", "military_service", "cnh", "aso", "outros",
] as const;

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  cpf: "CPF",
  rg: "RG",
  rg_front: "RG — Frente (legado)",
  rg_back: "RG — Verso (legado)",
  proof_of_address: "Comprovante de residência",
  photo: "Foto",
  bank_document: "Documento bancário",
  ctps: "CTPS",
  nis_pis_proof: "Comprovante NIS/PIS/NIT",
  voter_id: "Título de eleitor",
  military_service: "Reservista",
  cnh: "CNH",
  aso: "ASO",
  outros: "Outros (complementares)",
};

export const DOC_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  uploaded: "Enviado",
  approved: "Aprovado",
  rejected: "Rejeitado",
  replace: "Substituir",
};

export function computeFieldCompleteness(worker: Record<string, any>) {
  const filledRequired = REQUIRED_FIELDS.filter((f) => {
    const v = worker[f];
    return v !== null && v !== undefined && v !== "";
  });
  const filledRecommended = RECOMMENDED_FIELDS.filter((f) => {
    const v = worker[f];
    return v !== null && v !== undefined && v !== "";
  });
  const missingRequired = REQUIRED_FIELDS.filter((f) => !filledRequired.includes(f));
  const missingRecommended = RECOMMENDED_FIELDS.filter((f) => !filledRecommended.includes(f));

  return {
    requiredTotal: REQUIRED_FIELDS.length,
    requiredFilled: filledRequired.length,
    missingRequired,
    recommendedTotal: RECOMMENDED_FIELDS.length,
    recommendedFilled: filledRecommended.length,
    missingRecommended,
  };
}

// NOTE: `computeDocCompleteness` and `isDpReady` were removed.
// Consumers must now call the canonical RPC via the
// `useWorkerCompletion(workerId)` hook (see `src/hooks/useWorkerCompletion.ts`)
// and combine it with `computeFieldCompleteness(worker)`.

export const FIELD_LABELS: Record<string, string> = {
  full_name: "Nome completo",
  nickname: "Apelido",
  cpf: "CPF",
  birth_date: "Data de nascimento",
  gender: "Sexo",
  race_color: "Raça/Cor",
  nationality: "Nacionalidade",
  birth_country: "País de nascimento",
  mother_name: "Nome da mãe",
  rg: "RG",
  rg_issuer: "Órgão emissor do RG",
  rg_state: "UF do RG",
  phone_main: "Telefone principal",
  address: "Endereço",
  city: "Cidade",
  state: "UF",
  zip_code: "CEP",
  social_name: "Nome social",
  father_name: "Nome do pai",
  education_level: "Grau de instrução",
  nis_pis: "NIS/PIS/PASEP",
  ctps_number: "CTPS número",
  ctps_series: "CTPS série",
  ctps_state: "CTPS UF",
  email: "E-mail",
};
