/**
 * Captura de diagnóstico de falhas de RPC.
 *
 * Objetivo: quando `register_sst_revision` (ou similar) falhar, gerar um bundle
 * estruturado com request/response, `document_type_id`, categoria do catálogo
 * e versão do bundle — sem exigir que o operador reabra DevTools.
 *
 * Uso:
 *   const bundle = captureRpcFailure({
 *     rpc: "register_sst_revision",
 *     payload,
 *     error: rpcErr,
 *     context: { workerId, documentTypeId, category, mode },
 *   });
 *   // bundle.id — mostrado no toast
 *   // copyRpcFailure(bundle) — copia JSON para clipboard
 */

export type RpcFailureBundle = {
  id: string;
  bundle_version: string;
  captured_at: string;
  rpc: string;
  context: Record<string, unknown>;
  request: unknown;
  response: {
    message: string | null;
    code: string | null;
    details: string | null;
    hint: string | null;
    status: number | null;
    raw: unknown;
  };
  env: {
    user_agent: string;
    url: string;
    mode: string;
  };
};

// Versão do bundle de diagnóstico. Ao alterar formato, incrementar.
// A string de build é injetada via `import.meta.env.VITE_BUILD_ID` quando
// disponível — caso contrário, cai no modo do Vite (development/production).
const DIAG_SCHEMA_VERSION = "1";
const BUILD_ID =
  (import.meta as any)?.env?.VITE_BUILD_ID ||
  (import.meta as any)?.env?.MODE ||
  "unknown";
export const BUNDLE_VERSION = `diag/${DIAG_SCHEMA_VERSION}+build/${BUILD_ID}`;

const RING_KEY = "__rpc_failures__";
const RING_MAX = 20;

function shortId() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function extractError(error: any) {
  if (!error) {
    return { message: null, code: null, details: null, hint: null, status: null, raw: null };
  }
  return {
    message: error.message ?? String(error) ?? null,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    status: error.status ?? null,
    // Serialização defensiva: erros do PostgREST costumam ter propriedades enumeráveis,
    // mas Error nativo não. Preservamos o `toString` como fallback.
    raw:
      typeof error === "object"
        ? JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)))
        : String(error),
  };
}

export function captureRpcFailure(args: {
  rpc: string;
  payload: unknown;
  error: unknown;
  context?: Record<string, unknown>;
}): RpcFailureBundle {
  const bundle: RpcFailureBundle = {
    id: shortId(),
    bundle_version: BUNDLE_VERSION,
    captured_at: new Date().toISOString(),
    rpc: args.rpc,
    context: args.context ?? {},
    request: args.payload,
    response: extractError(args.error),
    env: {
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
      url: typeof location !== "undefined" ? location.href : "n/a",
      mode: (import.meta as any)?.env?.MODE ?? "unknown",
    },
  };

  // Log estruturado no console — permite copiar como objeto real via DevTools.
  // eslint-disable-next-line no-console
  console.error(`[rpc-failure] ${args.rpc}`, bundle);

  // Ring buffer em window + sessionStorage para inspeção posterior.
  try {
    const w = window as any;
    const ring: RpcFailureBundle[] = Array.isArray(w[RING_KEY]) ? w[RING_KEY] : [];
    ring.unshift(bundle);
    w[RING_KEY] = ring.slice(0, RING_MAX);
    sessionStorage.setItem(RING_KEY, JSON.stringify(w[RING_KEY]));
  } catch {
    // sessionStorage indisponível — segue apenas com console.
  }

  return bundle;
}

export async function copyRpcFailure(bundle: RpcFailureBundle): Promise<boolean> {
  const text = JSON.stringify(bundle, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function readRpcFailures(): RpcFailureBundle[] {
  try {
    const w = window as any;
    if (Array.isArray(w[RING_KEY])) return w[RING_KEY];
    const raw = sessionStorage.getItem(RING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}