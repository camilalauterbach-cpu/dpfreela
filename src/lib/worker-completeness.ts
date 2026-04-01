// DP-readiness logic for workers

export const REQUIRED_FIELDS = [
  "full_name", "nickname", "cpf", "birth_date", "gender", "race_color",
  "nationality", "birth_country", "mother_name", "rg", "rg_issuer",
  "rg_state", "phone_main", "address", "city", "state", "zip_code",
] as const;

export const RECOMMENDED_FIELDS = [
  "social_name", "father_name", "education_level", "nis_pis",
  "ctps_number", "ctps_series", "ctps_state", "email",
] as const;

export const REQUIRED_DOC_CATEGORIES = [
  "cpf", "rg_front", "rg_back", "proof_of_address", "photo", "bank_document",
] as const;

export const CONDITIONAL_DOC_CATEGORIES = [
  "ctps", "nis_pis_proof", "voter_id", "military_service", "cnh", "aso",
] as const;

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  cpf: "CPF",
  rg_front: "RG — Frente",
  rg_back: "RG — Verso",
  proof_of_address: "Comprovante de residência",
  photo: "Foto",
  bank_document: "Documento bancário",
  ctps: "CTPS",
  nis_pis_proof: "Comprovante NIS/PIS/NIT",
  voter_id: "Título de eleitor",
  military_service: "Reservista",
  cnh: "CNH",
  aso: "ASO",
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

export function computeDocCompleteness(docs: Array<{ category: string | null; status: string }>) {
  const approvedCategories = new Set(
    docs.filter((d) => d.status === "approved").map((d) => d.category)
  );
  const approvedRequired = REQUIRED_DOC_CATEGORIES.filter((c) => approvedCategories.has(c));
  const missingRequired = REQUIRED_DOC_CATEGORIES.filter((c) => !approvedCategories.has(c));

  return {
    requiredTotal: REQUIRED_DOC_CATEGORIES.length,
    requiredApproved: approvedRequired.length,
    missingRequired,
  };
}

export function isDpReady(
  worker: Record<string, any>,
  docs: Array<{ category: string | null; status: string }>
) {
  const fields = computeFieldCompleteness(worker);
  const docStatus = computeDocCompleteness(docs);
  return fields.missingRequired.length === 0 && docStatus.missingRequired.length === 0;
}

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
