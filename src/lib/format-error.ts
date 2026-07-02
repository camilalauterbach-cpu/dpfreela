// Extracts a rich, user-facing description from a Supabase/PostgREST error,
// a plain Error, an HTTP fetch failure, or any unknown value. Includes the
// original message, PostgREST `code`/`details`/`hint` when present, and the
// HTTP status/statusText when the error came from a fetch response.
//
// Intended for `toast({ description: formatSupabaseError(err) })` inside
// mutation `onError` handlers so the user sees what actually broke instead
// of a silent success.
export function formatSupabaseError(err: unknown): string {
  if (err == null) return "Erro desconhecido.";
  if (typeof err === "string") return err;

  const anyErr = err as Record<string, any>;
  const parts: string[] = [];

  const message: string | undefined =
    anyErr.message || anyErr.error_description || anyErr.error;
  if (message) parts.push(String(message));

  // PostgREST / PostgreSQL error metadata
  if (anyErr.code) parts.push(`código ${anyErr.code}`);
  if (anyErr.details) parts.push(String(anyErr.details));
  if (anyErr.hint) parts.push(`dica: ${anyErr.hint}`);

  // HTTP status when available (fetch Response, Supabase-JS error, etc.)
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr?.response?.status;
  const statusText = anyErr.statusText ?? anyErr?.response?.statusText;
  if (status) parts.push(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);

  // Friendlier hint for the most common RLS failure so non-technical users
  // understand why the save was rejected.
  const combined = parts.join(" · ").toLowerCase();
  if (
    combined.includes("permission denied") ||
    combined.includes("row-level security") ||
    combined.includes("row level security") ||
    anyErr.code === "42501"
  ) {
    parts.push(
      "Você não tem permissão para essa operação. Verifique seu papel de acesso ou faça login novamente."
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "Erro desconhecido.";
}