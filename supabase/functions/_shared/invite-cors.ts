// Shared CORS + helpers for invite edge functions.
// Origins come from INVITE_ALLOWED_ORIGINS (comma-separated). No wildcard.
// When the incoming Origin is not on the allow-list, we omit
// Access-Control-Allow-Origin entirely so the browser rejects the response.

const DEFAULT_ORIGINS = [
  "https://dpfreela.lovable.app",
  "https://dpfreela.com",
  "https://www.dpfreela.com",
];

export function allowedOrigins(): string[] {
  const raw = Deno.env.get("INVITE_ALLOWED_ORIGINS") ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.includes("*"));
  return list.length > 0 ? list : DEFAULT_ORIGINS;
}

export function baseCors(origin: string | null): HeadersInit {
  const list = allowedOrigins();
  const h: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
  };
  if (origin && list.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

export function wrap(res: Response, headers: HeadersInit): Response {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v as string);
  return res;
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Base64URL, no padding
export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes); // ~43 chars
}

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  return e;
}

export function clampTtlHours(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 168) return null;
  return Math.floor(n);
}

export function isAllowedInviteRole(v: unknown): v is "viewer" | "operator" {
  return v === "viewer" || v === "operator";
}

export interface AuthedCaller {
  id: string;
  token: string;
}

export async function requireAdminOrManager(
  req: Request,
  admin: any,
): Promise<AuthedCaller | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json({ ok: false, error: "unauthorized" }, 401);
  const callerId: string = data.user.id;
  const { data: canAct, error: roleErr } = await admin.rpc("has_any_role", {
    _user_id: callerId,
    _roles: ["admin", "manager"],
  });
  if (roleErr || !canAct) return json({ ok: false, error: "forbidden" }, 403);
  return { id: callerId, token };
}

export function assertInviteSecret(): string | Response {
  const s = Deno.env.get("INVITE_TOKEN_SECRET");
  if (!s || s.length < 64) {
    console.error("INVITE_SECRET_NOT_CONFIGURED");
    return json(
      { ok: false, error: "Serviço temporariamente indisponível." },
      503,
    );
  }
  return s;
}

export function buildPublicLink(token: string): string {
  const base = Deno.env.get("INVITE_PUBLIC_BASE_URL") ?? "https://dpfreela.com";
  return `${base.replace(/\/+$/, "")}/invite/${token}`;
}