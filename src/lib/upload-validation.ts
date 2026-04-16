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
  // Alguns navegadores enviam type vazio — aí confiamos na extensão
  if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Tipo de arquivo não permitido. Aceitos: PDF, JPG, PNG, WebP.";
  }
  if (!file.type) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) {
      return "Tipo de arquivo não permitido. Aceitos: PDF, JPG, PNG, WebP.";
    }
  }
  return null;
}
