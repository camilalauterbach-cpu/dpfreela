/**
 * Validação centralizada de uploads.
 * - Limite: 10 MB por arquivo
 * - Tipos aceitos: PDF, JPEG, PNG, WebP
 *
 * Uso:
 *   const err = validateUpload(file);
 *   if (err) { toast({ title: err, variant: "destructive" }); return; }
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ALLOWED_FILE_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.webp";

export function validateUpload(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `Arquivo muito grande (${mb} MB). Limite: 10 MB.`;
  }
  // Exigir MIME válido enviado pelo navegador. Sem fallback por extensão
  // (evita upload de HTML/JS renomeado como .pdf).
  if (!file.type || !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Tipo de arquivo não permitido. Aceitos: PDF, JPG, PNG, WebP.";
  }
  return null;
}

/**
 * Retorna um Content-Type seguro (sempre da allow-list) a ser passado no
 * `storage.upload({ contentType })`. Nunca confia em valores arbitrários do
 * navegador — apenas em tipos previamente validados.
 */
export function getSafeContentType(file: File): string {
  if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return file.type;
  }
  return "application/octet-stream";
}
