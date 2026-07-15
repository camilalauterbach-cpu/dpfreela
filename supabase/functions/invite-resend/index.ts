// Edge Function: invite-resend (admin/manager only, verify_jwt = true).
// Revokes the previous invite and creates a new one with a fresh token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  baseCors, wrap, json,
  sha256Hex, generateToken, clampTtlHours,
  requireAdminOrManager, assertInviteSecret, buildPublicLink,
} from "../_shared/invite-cors.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = baseCors(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return wrap(json({ ok: false, error: "method_not_allowed" }, 405), cors);

  try {
    const secret = assertInviteSecret();
    if (secret instanceof Response) return wrap(secret, cors);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const caller = await requireAdminOrManager(req, admin);
    if (caller instanceof Response) return wrap(caller, cors);

    const body = await req.json().catch(() => ({}));
    const inviteId = body?.invite_id;
    if (typeof inviteId !== "string" || !/^[0-9a-f-]{36}$/i.test(inviteId)) {
      return wrap(json({ ok: false, error: "invalid_request" }, 400), cors);
    }
    const ttlH = clampTtlHours(body?.ttl_hours ?? 72);
    if (ttlH === null) return wrap(json({ ok: false, error: "invalid_ttl" }, 400), cors);

    const token = generateToken();
    const newHash = await sha256Hex(`${secret}:${token}`);
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000).toISOString();

    const { data, error } = await admin.rpc("resend_invite", {
      _acting_user_id: caller.id,
      _invite_id: inviteId,
      _new_token_hash: newHash,
      _expires_at: expiresAt,
    });
    if (error) {
      const code = String((error as any).message ?? "");
      const known = ["invite_not_found","invite_not_resendable","invalid_ttl","invalid_token_hash","worker_not_found","worker_already_linked","forbidden","not_authenticated"];
      const msg = known.find((k) => code.includes(k)) ?? "invalid_request";
      const status = msg === "forbidden" ? 403 : msg === "not_authenticated" ? 401 : 400;
      return wrap(json({ ok: false, error: msg }, status), cors);
    }

    return wrap(json({
      ok: true,
      invite_id: (data as any)?.invite_id ?? null,
      previous_invite_id: (data as any)?.previous_invite_id ?? null,
      link: buildPublicLink(token),
      expires_at: expiresAt,
    }, 200), cors);
  } catch (e) {
    console.error("invite-resend failure", (e as Error).message);
    return wrap(json({ ok: false, error: "internal_error" }, 500), cors);
  }
});