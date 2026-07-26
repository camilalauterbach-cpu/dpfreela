// Contract tests for storage-cleanup-process.
//
// Each test hits the deployed Edge Function. These are auth/method contract
// checks only — they never mutate real jobs (dry-run + cron path is verified
// safe by asserting `dryRun:true` responses do not include `completed`/`failed`
// mutations and by not calling the non-dry-run path from tests).
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const CRON_SECRET = Deno.env.get("CLEANUP_CRON_SECRET") ?? "";
const FN = `${SUPABASE_URL}/functions/v1/storage-cleanup-process`;

async function call(init: RequestInit) {
  const res = await fetch(FN, init);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

Deno.test("GET is 405", async () => {
  const r = await call({ method: "GET", headers: { apikey: ANON_KEY } });
  assertEquals(r.status, 405);
});

Deno.test("PUT is 405", async () => {
  const r = await call({ method: "PUT", headers: { apikey: ANON_KEY } });
  assertEquals(r.status, 405);
});

Deno.test("OPTIONS is 200 (CORS)", async () => {
  const r = await call({ method: "OPTIONS" });
  assert(r.status === 200 || r.status === 204);
});

Deno.test("POST without JWT and without cron secret => 401", async () => {
  const r = await call({
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ status: true }),
  });
  assertEquals(r.status, 401);
});

Deno.test("POST with wrong cron secret => 401", async () => {
  const r = await call({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      "x-cron-secret": "definitely-not-the-real-secret-xxxxxxxxxx",
    },
    body: JSON.stringify({ dryRun: true }),
  });
  assertEquals(r.status, 401);
});

Deno.test("POST with invalid JWT => 401", async () => {
  const r = await call({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: "Bearer not.a.valid.jwt",
    },
    body: JSON.stringify({ status: true }),
  });
  assertEquals(r.status, 401);
});

Deno.test({
  name: "POST with correct cron secret + dryRun:true => 200, no mutation fields",
  ignore: CRON_SECRET.length < 16,
  fn: async () => {
    const r = await call({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({ dryRun: true, limit: 5 }),
    });
    assertEquals(r.status, 200);
    const b = r.body as Record<string, unknown>;
    assertEquals(b.dryRun, true);
    assertEquals(b.cron, true);
    // dry-run é read-only: nunca completa/falha jobs.
    assertEquals(b.completed, 0);
    assertEquals(b.failed, 0);
  },
});

Deno.test({
  name: "cron cannot activateCron (403)",
  ignore: CRON_SECRET.length < 16,
  fn: async () => {
    const r = await call({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({ activateCron: true }),
    });
    assertEquals(r.status, 403);
  },
});