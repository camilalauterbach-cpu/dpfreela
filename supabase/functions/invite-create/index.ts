// Edge Function: invite-create (admin/manager only, verify_jwt = true).
// Generates a cryptographically random invite token, stores only the hash,
// and returns the one-time public link. The plaintext token never touches the DB.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  baseCors,
  wrap,
  json,
  sha256Hex,
  generateToken,
  normalizeEmail,
  clampTtlHours,
  isAllowedInviteRole,
  requireAdminOrManager,
  assertInviteSecret,
  buildPublicLink,
} from "../_shared/invite-cors.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = baseCors(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return wrap(json({ ok: false, error: "method_not_allowed" }, 405), cors);

  try {
    const secret = assertInviteSecret();
    if (secret instanceof Response) return wrap(secret, cors);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await requireAdminOrManager(req, admin);
    if (caller instanceof Response) return wrap(caller, cors);

    const ct = req.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("application/json")) {
      return wrap(json({ ok: false, error: "unsupported_media_type" }, 415), cors);
    }
    const raw = await req.text();
    if (new Blob([raw]).size > 2048) {
      return wrap(json({ ok: false, error: "payload_too_large" }, 413), cors);
    }
    let body: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return wrap(json({ ok: false, error: "invalid_body" }, 400), cors);
    }

    const email = normalizeEmail(body.email);
    if (!email) return wrap(json({ ok: false, error: "invalid_email" }, 400), cors);

    const role = body.role;
    if (!isAllowedInviteRole(role)) {
      return wrap(json({ ok: false, error: "invalid_role" }, 400), cors);
    }

    const ttlH = clampTtlHours(body.ttl_hours ?? 72);
    if (ttlH === null) return wrap(json({ ok: false, error: "invalid_ttl" }, 400), cors);

    let linkedWorkerId: string | null = null;
    if (body.linked_worker_id != null && body.linked_worker_id !== "") {
      if (typeof body.linked_worker_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(body.linked_worker_id)) {
        return wrap(json({ ok: false, error: "invalid_worker" }, 400), cors);
      }
      linkedWorkerId = body.linked_worker_id;
    }

    const token = generateToken();
    const tokenHash = await sha256Hex(`${secret}:${token}`);
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000).toISOString();

    const { data, error } = await admin.rpc("create_invite_record", {
      _acting_user_id: caller.id,
      _email: email,
      _role: role,
      _linked_worker_id: linkedWorkerId,
      _token_hash: tokenHash,
      _expires_at: expiresAt,
    });
    if (error) {
      const code = (error as any).message ?? "invalid_request";
      const known = ["invite_already_pending","invalid_role","invalid_email","invalid_ttl","invalid_token_hash","worker_not_found","worker_already_linked","forbidden","not_authenticated"];
      const msg = known.find((k) => String(code).includes(k)) ?? "invalid_request";
      const status = msg === "forbidden" ? 403 : msg === "not_authenticated" ? 401 : 400;
      return wrap(json({ ok: false, error: msg }, status), cors);
    }

    const inviteId = (data as any)?.invite_id ?? null;
    return wrap(json({
      ok: true,
      invite_id: inviteId,
      link: buildPublicLink(token),
      expires_at: expiresAt,
    }, 200), cors);
  } catch (e) {
    console.error("invite-create failure", (e as Error).message);
    return wrap(json({ ok: false, error: "internal_error" }, 500), cors);
  }
});