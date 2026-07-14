// Inferência segura da NR a partir de campos do employment_link_documents.
// Regras (Entrega 6):
// - captura NRs via regex \bNR-?\s*0?(\d{1,2})\b em document_type/category/file_name/notes;
// - normaliza sempre para NR-XX com dois dígitos;
// - se houver mais de UMA NR distinta em qualquer campo => status="multiple"
//   (revisão manual obrigatória — nunca escolher a primeira);
// - se nenhuma pista existir => status="none" (categoria "Outros" → revisão manual);
// - status="single" só quando exatamente uma NR distinta foi identificada.

export type NrSource = "document_type" | "category" | "file_name" | "notes";

export type NrInferenceResult =
  | { status: "single"; nrCode: string; source: NrSource }
  | { status: "multiple"; nrCodes: string[]; sources: NrSource[] }
  | { status: "none" };

const NR_RE = /\bNR-?\s*0?(\d{1,2})\b/gi;

export function normalizeNr(raw: string | number): string {
  const n = String(raw).trim();
  const m = n.match(/(\d{1,2})/);
  if (!m) return "";
  const num = parseInt(m[1], 10);
  if (!Number.isFinite(num) || num < 1 || num > 99) return "";
  return `NR-${num.toString().padStart(2, "0")}`;
}

function extractAll(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const src = text.replace(/_/g, " ");
  let m: RegExpExecArray | null;
  NR_RE.lastIndex = 0;
  while ((m = NR_RE.exec(src)) !== null) {
    const code = normalizeNr(m[1]);
    if (code) out.add(code);
  }
  return Array.from(out);
}

export interface NrInferenceInput {
  document_type?: string | null;
  category?: string | null;
  file_name?: string | null;
  notes?: string | null;
}

export function inferNrCode(input: NrInferenceInput): NrInferenceResult {
  const order: NrSource[] = ["document_type", "category", "file_name", "notes"];
  const perSource: Array<{ source: NrSource; codes: string[] }> = order.map((s) => ({
    source: s,
    codes: extractAll(input[s] as string | null | undefined),
  }));

  const allCodes = new Set<string>();
  const sourcesWithHits: NrSource[] = [];
  for (const { source, codes } of perSource) {
    if (codes.length === 0) continue;
    sourcesWithHits.push(source);
    for (const c of codes) allCodes.add(c);
  }

  if (allCodes.size === 0) return { status: "none" };
  if (allCodes.size > 1) {
    return {
      status: "multiple",
      nrCodes: Array.from(allCodes).sort(),
      sources: sourcesWithHits,
    };
  }
  // exatamente 1 NR distinta em todos os campos analisados
  const nrCode = Array.from(allCodes)[0];
  const firstHit = perSource.find((p) => p.codes.length > 0)!;
  return { status: "single", nrCode, source: firstHit.source };
}

// Mapeamento de status documental do link -> document_status do SST.
export function mapDocStatus(
  status: string | null | undefined,
): "ok" | "rejected" | "pending" {
  const s = (status || "").toLowerCase();
  if (s === "approved") return "ok";
  if (s === "rejected") return "rejected";
  return "pending";
}