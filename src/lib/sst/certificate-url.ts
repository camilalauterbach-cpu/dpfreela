// Helper único para abrir certificados SST armazenados no bucket privado
// `worker-documents`. O valor persistido em `document_url` é sempre o path
// interno do Storage (ex.: `sst/{workerId}/{NR}/...`); nunca uma URL HTTP.
// Este helper resolve para uma Signed URL de curta duração e abre em nova aba.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BUCKET = "worker-documents";
// TTL da Signed URL — configurável por env sem recompilar caso a política mude.
const DEFAULT_EXPIRES_IN = Number(
  (import.meta as any).env?.VITE_CERTIFICATE_URL_TTL ?? 600,
);
// Margem de segurança para reaproveitar URL do cache em memória.
const CACHE_SAFETY_WINDOW_MS = 30_000;

interface CacheEntry { signedUrl: string; expiresAt: number }
const urlCache = new Map<string, CacheEntry>();

function cacheKey(path: string, download: boolean) {
  return `${download ? "dl:" : "vw:"}${path}`;
}

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
 * Faz cache em memória enquanto restar > 30s de validade.
 */
export async function resolveCertificateUrl(
  documentUrl: string | null | undefined,
  expiresIn: number = DEFAULT_EXPIRES_IN,
  opts?: { download?: boolean | string },
): Promise<string | null> {
  if (!documentUrl) return null;
  if (isAbsoluteUrl(documentUrl)) return documentUrl;
  const path = normalizePath(documentUrl);
  if (!path) return null;

  const download = opts?.download ?? false;
  const key = cacheKey(path, !!download);
  const now = Date.now();
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > now + CACHE_SAFETY_WINDOW_MS) {
    return cached.signedUrl;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn, download ? { download: download as any } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Não foi possível gerar a URL do certificado.");
  }
  urlCache.set(key, {
    signedUrl: data.signedUrl,
    expiresAt: now + expiresIn * 1000,
  });
  return data.signedUrl;
}

/**
 * Abre o certificado em nova aba, gerando Signed URL sob demanda.
 * Pré-abre a aba no clique (síncrono) para escapar do bloqueador de pop-ups,
 * e depois define a URL final quando a Signed URL fica pronta.
 */
export async function openCertificate(
  documentUrl: string | null | undefined,
): Promise<void> {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  try {
    const url = await resolveCertificateUrl(documentUrl);
    if (!url) {
      popup?.close();
      toast.error("Certificado indisponível.");
      return;
    }
    if (popup) popup.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (e: any) {
    popup?.close();
    toast.error(String(e?.message || "Falha ao abrir certificado."));
  }
}

/**
 * Força o download do certificado (sem abrir aba). Reutiliza o cache com
 * chave separada porque o parâmetro `download` altera o Content-Disposition.
 */
export async function downloadCertificate(
  documentUrl: string | null | undefined,
  filename?: string,
): Promise<void> {
  try {
    const url = await resolveCertificateUrl(documentUrl, DEFAULT_EXPIRES_IN, {
      download: filename || true,
    });
    if (!url) {
      toast.error("Certificado indisponível.");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e: any) {
    toast.error(String(e?.message || "Falha ao baixar certificado."));
  }
}