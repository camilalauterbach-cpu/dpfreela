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

/**
 * User-facing variant that hides internal database structure (column names,
 * PostgreSQL codes, raw Supabase payloads, RLS policy identifiers) while
 * still telling the user *why* the operation failed in plain language.
 *
 * Full technical details remain available via `formatSupabaseError` and
 * should be sent to the console/dev logs, not the toast.
 */
export function formatSupabaseErrorForUser(err: unknown): string {
  if (err == null) return "Erro desconhecido. Tente novamente em instantes.";
  if (typeof err === "string") return err;

  const anyErr = err as Record<string, any>;
  const code = anyErr.code as string | undefined;
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr?.response?.status;
  const raw = String(
    anyErr.message || anyErr.error_description || anyErr.error || ""
  ).toLowerCase();

  // Permission / RLS
  if (
    code === "42501" ||
    status === 401 ||
    status === 403 ||
    raw.includes("permission denied") ||
    raw.includes("row-level security") ||
    raw.includes("row level security") ||
    raw.includes("jwt") ||
    raw.includes("not authorized")
  ) {
    return "Você não tem permissão para essa operação. Verifique seu papel de acesso ou faça login novamente.";
  }

  // Unique constraint
  if (code === "23505" || raw.includes("duplicate key")) {
    return "Já existe um registro com esses dados. Verifique se não é uma duplicidade.";
  }

  // Foreign key
  if (code === "23503") {
    return "Este registro está vinculado a outros dados e não pode ser alterado ou removido nesse formato.";
  }

  // Not-null / check
  if (code === "23502" || code === "23514") {
    return "Há campos obrigatórios ou inválidos. Revise o formulário e tente novamente.";
  }

  // Network / offline
  if (raw.includes("failed to fetch") || raw.includes("networkerror")) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }

  // Server errors
  if (typeof status === "number" && status >= 500) {
    return "O serviço está temporariamente indisponível. Tente novamente em alguns instantes.";
  }

  // Fallback: return the short message if it looks user-friendly, otherwise
  // a generic sentence. Never leak column names, SQL, or JSON payloads.
  const short = String(anyErr.message || "").trim();
  if (
    short &&
    short.length < 160 &&
    !short.startsWith("{") &&
    !short.includes("relation ") &&
    !short.includes("column ")
  ) {
    return short;
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}