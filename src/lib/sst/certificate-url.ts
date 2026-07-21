// Helper único para abrir certificados SST armazenados no bucket privado
// `worker-documents`. O valor persistido em `document_url` é sempre o path
// interno do Storage (ex.: `sst/{workerId}/{NR}/...`); nunca uma URL HTTP.
// Este helper resolve para uma Signed URL de curta duração e abre em nova aba.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BUCKET = "worker-documents";
const DEFAULT_EXPIRES_IN = 60 * 10; // 10 minutos

/** Retorna true se o valor já é uma URL HTTP(S) absoluta. */
function isAbsoluteUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

/** Normaliza o path removendo prefixos acidentais (`/`, `worker-documents/`). */
function normalizePath(path: string): string {
  let p = path.trim();
  if (p.startsWith("/")) p = p.slice(1);
  const prefix = `${BUCKET}/`;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p;
}

/**
 * Resolve `document_url` (path interno do Storage) para uma URL utilizável.
 * Se o valor já for absoluto (legado), devolve como está.
 */
export async function resolveCertificateUrl(
  documentUrl: string | null | undefined,
  expiresIn: number = DEFAULT_EXPIRES_IN,
): Promise<string | null> {
  if (!documentUrl) return null;
  if (isAbsoluteUrl(documentUrl)) return documentUrl;
  const path = normalizePath(documentUrl);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Não foi possível gerar a URL do certificado.");
  }
  return data.signedUrl;
}

/** Abre o certificado em nova aba, gerando Signed URL sob demanda. */
export async function openCertificate(
  documentUrl: string | null | undefined,
): Promise<void> {
  try {
    const url = await resolveCertificateUrl(documentUrl);
    if (!url) {
      toast.error("Certificado indisponível.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e: any) {
    toast.error(String(e?.message || "Falha ao abrir certificado."));
  }
}