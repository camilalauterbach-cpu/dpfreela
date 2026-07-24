import type { APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Q-024.B-E2E — typed helper for `public.register_sst_revision`.
 *
 * - Performs the real POST to the Supabase REST-RPC endpoint.
 * - Preserves HTTP status and PostgREST error metadata (code/message/details/hint).
 * - Never swallows an error into an empty object.
 * - Never logs the access token or file payloads.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "";
const ACCESS_TOKEN =
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";

export interface RegisterSstRevisionPayload {
  worker_id: string;
  document_type_id?: string;
  nr_code?: string;
  operation:
    | "initial"
    | "renewal"
    | "replacement"
    | "correction"
    | "additional";
  expected_current_qualification_id?: string | null;
  previous_qualification_id?: string | null;
  issued_at: string; // YYYY-MM-DD
  expires_at?: string | null;
  validity_status?: "has_expiry" | "no_expiry" | "unknown";
  revision_reason?: string | null;
  workload_hours?: number | null;
  provider_name?: string | null;
  instructor_name?: string | null;
  notes?: string | null;
  source_type?: "manual" | "link_document" | "import";
  training_type?: string | null;
  document_url?: string | null;
  document_status?: string;
}

export interface RegisterSstRevisionResult {
  result: "ok";
  qualification_id: string;
  current_qualification_id: string;
  previous_qualification_id: string | null;
  revision_type: string;
  requested_revision_type: string;
  compatibility_mode: boolean;
  compatibility_input: Record<string, unknown>;
  document_type_id: string;
  document_type_code: string;
  expires_at: string | null;
  expiry_source: string;
  validity_days_used: number | null;
}

export interface RegisterSstRevisionRpcError {
  ok: false;
  status: number;
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  rawBody: string;
}

export type RegisterSstRevisionOutcome =
  | { ok: true; status: number; data: RegisterSstRevisionResult }
  | RegisterSstRevisionRpcError;

function sanitizeForReport(
  payload: RegisterSstRevisionPayload,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  if ("document_url" in clone) clone.document_url = "[redacted]";
  return clone;
}

export function assertEnvReady(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error(
      "SUPABASE URL/anon key are required (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  if (!ACCESS_TOKEN) {
    throw new Error(
      "LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN is required for authenticated E2E.",
    );
  }
}

export async function callRegisterSstRevision(
  request: APIRequestContext,
  payload: RegisterSstRevisionPayload,
): Promise<RegisterSstRevisionOutcome> {
  assertEnvReady();
  const response: APIResponse = await request.post(
    `${SUPABASE_URL}/rest/v1/rpc/register_sst_revision`,
    {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: { payload },
    },
  );

  const status = response.status();
  const rawBody = await response.text();

  if (status >= 200 && status < 300) {
    let parsed: RegisterSstRevisionResult;
    try {
      parsed = JSON.parse(rawBody) as RegisterSstRevisionResult;
    } catch (err) {
      throw new Error(
        `register_sst_revision returned non-JSON on success (status ${status}): ${rawBody}`,
      );
    }
    return { ok: true, status, data: parsed };
  }

  let code: string | undefined;
  let message: string | undefined;
  let details: string | undefined;
  let hint: string | undefined;
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    code = typeof body.code === "string" ? body.code : undefined;
    message = typeof body.message === "string" ? body.message : undefined;
    details = typeof body.details === "string" ? body.details : undefined;
    hint = typeof body.hint === "string" ? body.hint : undefined;
  } catch {
    /* keep rawBody */
  }
  return {
    ok: false,
    status,
    code,
    message,
    details,
    hint,
    rawBody,
  };
}

export function describeOutcome(
  outcome: RegisterSstRevisionOutcome,
  payload: RegisterSstRevisionPayload,
): string {
  const sanitized = sanitizeForReport(payload);
  if (outcome.ok) {
    return `[OK ${outcome.status}] ${JSON.stringify({
      payload: sanitized,
      result: outcome.data,
    })}`;
  }
  return `[ERR ${outcome.status}] ${JSON.stringify({
    payload: sanitized,
    code: outcome.code,
    message: outcome.message,
    details: outcome.details,
    hint: outcome.hint,
    rawBody: outcome.rawBody,
  })}`;
}