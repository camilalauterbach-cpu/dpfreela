// Edge Function: public-invite-accept
// Aceita convite público, cria/reutiliza usuário e completa o convite de forma atômica.
// Sem verify_jwt (endpoint público, protegido por rate limit + hash de token).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ---------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set([
  "https://dpfreela.lovable.app",
  "https://dpfreela.com",
  "https://www.dpfreela.com",
]);

const MAX_BODY_BYTES = 2 * 1024; // 2 KB

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://dpfreela.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
  };
}

function neutralError(status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "invalid_request" }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function serviceUnavailable(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "Não foi possível concluir o cadastro neste momento." }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

function neutralSuccess(): Response {
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const baseHeaders = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  const wrap = (r: Response) => {
    for (const [k, v] of Object.entries(baseHeaders)) r.headers.set(k, v as string);
    return r;
  };

  try {
    // 0. Fail-closed: sem segredo forte, nada é executado.
    const inviteSecret = Deno.env.get("INVITE_TOKEN_SECRET");
    if (!inviteSecret || inviteSecret.length < 64) {
      console.error("INVITE_SECRET_NOT_CONFIGURED");
      return wrap(serviceUnavailable());
    }

    // 1. método
    if (req.method !== "POST") return wrap(neutralError(405));

    // 2. content-type
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("application/json")) return wrap(neutralError(415));

    // 3. tamanho
    const raw = await req.text();
    if (new Blob([raw]).size > MAX_BODY_BYTES) return wrap(neutralError(413));

    // 4. parse restrito
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return wrap(neutralError(400));
    }
    if (typeof parsed !== "object" || parsed === null) return wrap(neutralError(400));
    const body = parsed as Record<string, unknown>;
    const token = body.token;
    const password = body.password;
    if (typeof token !== "string" || token.length < 16 || token.length > 512) {
      return wrap(neutralError(400));
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      return wrap(neutralError(400));
    }

    // 5. hashes (segredo já validado no passo 0)
    const tokenHash = await sha256Hex(`${inviteSecret}:${token}`);
    const ipHash = await sha256Hex(`${inviteSecret}:${extractIp(req)}`);

    // 6. clientes
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 7. claim
    const { data: claimData, error: claimErr } = await admin.rpc("claim_public_invite", {
      _token_hash: tokenHash,
      _ip_hash: ipHash,
    });
    if (claimErr || !claimData) return wrap(neutralError(400));
    const claim = claimData as {
      invite_id: string;
      email: string;
      role: string;
      linked_worker_id: string | null;
      nonce: string;
    };

    const releaseAndFail = async (code: string) => {
      try {
        await admin.rpc("release_public_invite", {
          _invite_id: claim.invite_id,
          _nonce: claim.nonce,
          _error_code: code,
        });
      } catch (_) { /* silencioso */ }
      return wrap(neutralError(400));
    };

    // 8. criar ou reutilizar usuário no Auth
    let authUserId: string | null = null;
    const { data: existingList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
      // filtro por email não é oficialmente exposto; buscamos e filtramos manualmente
    });
    if (existingList?.users?.length) {
      // fallback: getUserByEmail via listUsers paginado
    }
    const { data: byEmail } = await admin.auth.admin.listUsers({ perPage: 200 });
    const found = byEmail?.users?.find((u) => (u.email ?? "").toLowerCase() === claim.email.toLowerCase());
    if (found) {
      authUserId = found.id;
      // atualizar senha e confirmar email idempotentemente
      await admin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
      });
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: claim.email,
        password,
        email_confirm: true,
      });
      if (createErr || !created?.user) return await releaseAndFail("auth_create_failed");
      authUserId = created.user.id;
    }

    // 9. localizar/criar profile e obter profiles.id real
    let profileId: string | null = null;
    {
      const { data: profRow } = await admin
        .from("profiles")
        .select("id")
        .eq("user_id", authUserId)
        .maybeSingle();
      if (profRow?.id) {
        profileId = profRow.id as string;
      } else {
        const { data: profIns, error: profErr } = await admin
          .from("profiles")
          .insert({ user_id: authUserId, full_name: "", avatar_url: "" })
          .select("id")
          .single();
        if (profErr || !profIns) return await releaseAndFail("profile_upsert_failed");
        profileId = profIns.id as string;
      }
    }

    // 10. completar
    const { error: completeErr } = await admin.rpc("complete_public_invite", {
      _invite_id: claim.invite_id,
      _nonce: claim.nonce,
      _auth_user_id: authUserId,
      _profile_id: profileId,
    });
    if (completeErr) return await releaseAndFail("complete_failed");

    return wrap(neutralSuccess());
  } catch (_e) {
    return wrap(neutralError(500));
  }
});