/**
 * E-DOC.2.A — Concorrência de `register_worker_document_revision`.
 *
 * Objetivo: garantir que múltiplas chamadas simultâneas para o mesmo
 * (worker_id, document_type_id) resultem em UMA única revisão vigente,
 * sem duplicatas em `public.worker_documents` nem em `public.change_logs`.
 *
 * Dois cenários:
 *  A) Mesma idempotency_key + mesmo payload em N chamadas paralelas
 *     → exatamente 1 INSERT (idempotent_hit=false) + N-1 idempotent_hit=true,
 *       todos retornando o mesmo document.id.
 *  B) Sem idempotency_key, N `initial` paralelos
 *     → exatamente 1 sucesso, N-1 falhas com `current_revision_already_exists`
 *       (ERRCODE 23505). O advisory lock + índice único garantem serialização.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, request as pwRequest } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

// ---- .env → process.env ---------------------------------------------------
function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadDotEnv();

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "";
const ACCESS_TOKEN =
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";

// ASO ativo canônico (categoria sst_aso, storage_scope=worker, fixed_duration).
const ASO_DOCUMENT_TYPE_ID = "9264e69e-401a-406c-a5a1-c3dc6ca16f98";

function psql(sql: string): string {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tAqc", sql], {
    encoding: "utf8",
    env: process.env,
  }).trim();
}
function psqlSafe(sql: string): void {
  try {
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tAqc", sql], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    /* best-effort */
  }
}

function generateCpf(): string {
  const nine: number[] = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 10),
  );
  const dv = (base: number[]) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++)
      sum += base[i] * (base.length + 1 - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = dv(nine);
  const d2 = dv([...nine, d1]);
  return [...nine, d1, d2].join("");
}

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type RpcOutcome =
  | { ok: true; status: number; idempotentHit: boolean; documentId: string }
  | { ok: false; status: number; code?: string; message?: string; rawBody: string };

async function callRpc(
  req: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<RpcOutcome> {
  const res: APIResponse = await req.post(
    `${SUPABASE_URL}/rest/v1/rpc/register_worker_document_revision`,
    {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: { p_payload: payload },
    },
  );
  const status = res.status();
  const raw = await res.text();
  if (status >= 200 && status < 300) {
    const body = JSON.parse(raw) as {
      idempotent_hit: boolean;
      document: { id: string };
    };
    return {
      ok: true,
      status,
      idempotentHit: !!body.idempotent_hit,
      documentId: body.document.id,
    };
  }
  let code: string | undefined;
  let message: string | undefined;
  try {
    const b = JSON.parse(raw) as Record<string, unknown>;
    code = typeof b.code === "string" ? b.code : undefined;
    message = typeof b.message === "string" ? b.message : undefined;
  } catch {
    /* keep raw */
  }
  return { ok: false, status, code, message, rawBody: raw };
}

let apiRequest: APIRequestContext;
let WORKER_ID = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (status !== "injected") {
    test.skip(true, `no injected auth (LOVABLE_BROWSER_AUTH_STATUS=${status})`);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON || !ACCESS_TOKEN) {
    throw new Error(
      "SUPABASE URL/anon key/access token required (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN).",
    );
  }
  if (!process.env.PGHOST) {
    throw new Error("psql env (PGHOST etc.) required.");
  }
  WORKER_ID = psql(
    `insert into public.workers (full_name, cpf) values ('E2E DocRevConc ${Date.now()}', '${generateCpf()}') returning id`,
  );
  expect(WORKER_ID).toMatch(/^[0-9a-f-]{36}$/);
  apiRequest = await pwRequest.newContext();
});

test.afterAll(async () => {
  if (WORKER_ID) {
    psqlSafe(
      `delete from public.change_logs where table_name='worker_documents' and record_id in (select id from public.worker_documents where worker_id='${WORKER_ID}')`,
    );
    psqlSafe(`delete from public.worker_documents where worker_id='${WORKER_ID}'`);
    psqlSafe(`delete from public.workers where id='${WORKER_ID}'`);
  }
  await apiRequest?.dispose();
});

function countRows(): { total: number; current: number; logs: number } {
  const line = psql(`
    select
      (select count(*) from public.worker_documents
        where worker_id='${WORKER_ID}' and document_type_id='${ASO_DOCUMENT_TYPE_ID}') || '|' ||
      (select count(*) from public.worker_documents
        where worker_id='${WORKER_ID}' and document_type_id='${ASO_DOCUMENT_TYPE_ID}'
          and is_current=true and deleted_at is null) || '|' ||
      (select count(*) from public.change_logs
        where table_name='worker_documents'
          and record_id in (select id from public.worker_documents
                              where worker_id='${WORKER_ID}'
                                and document_type_id='${ASO_DOCUMENT_TYPE_ID}'))
  `);
  const [total, current, logs] = line.split("|").map((n) => Number(n));
  return { total, current, logs };
}

function resetWorkerDocs(): void {
  psqlSafe(
    `delete from public.change_logs where table_name='worker_documents' and record_id in (select id from public.worker_documents where worker_id='${WORKER_ID}')`,
  );
  psqlSafe(`delete from public.worker_documents where worker_id='${WORKER_ID}'`);
}

// ---------------------------------------------------------------------------
// Cenário A — mesma idempotency_key + payload idênticos, N chamadas paralelas
// ---------------------------------------------------------------------------
test("concorrência idempotente: N chamadas com mesma key → 1 INSERT + N-1 hits", async () => {
  resetWorkerDocs();
  const N = 8;
  const idem = crypto.randomUUID();
  const stamp = Date.now();
  const payload = {
    worker_id: WORKER_ID,
    document_type_id: ASO_DOCUMENT_TYPE_ID,
    operation: "initial",
    idempotency_key: idem,
    file_path: `${WORKER_ID}/${ASO_DOCUMENT_TYPE_ID}/${stamp}.pdf`,
    file_name: `aso-${stamp}.pdf`,
    file_size: 1024,
    mime_type: "application/pdf",
    issued_at: isoToday(-1),
    document_number: "ASO-CONC-A",
    issuing_authority: "Clínica E2E",
  };

  const outcomes = await Promise.all(
    Array.from({ length: N }, () => callRpc(apiRequest, payload)),
  );

  const successes = outcomes.filter((o) => o.ok) as Extract<RpcOutcome, { ok: true }>[];
  const failures = outcomes.filter((o) => !o.ok) as Extract<RpcOutcome, { ok: false }>[];
  expect(
    failures,
    `nenhuma falha esperada, recebido: ${JSON.stringify(failures)}`,
  ).toHaveLength(0);
  expect(successes).toHaveLength(N);

  const inserts = successes.filter((s) => !s.idempotentHit);
  const hits = successes.filter((s) => s.idempotentHit);
  expect(inserts, "exatamente 1 INSERT esperado (auto-trigger única vez)").toHaveLength(1);
  expect(hits).toHaveLength(N - 1);

  // Todas as respostas apontam para o MESMO document.id (identidade canônica).
  const ids = new Set(successes.map((s) => s.documentId));
  expect(ids.size, `todas as chamadas devem retornar o mesmo document.id — recebido ${[...ids].join(",")}`).toBe(1);

  // DB reflete uma única linha vigente e um único log.
  const { total, current, logs } = countRows();
  expect(total).toBe(1);
  expect(current).toBe(1);
  expect(logs).toBe(1);
});

// ---------------------------------------------------------------------------
// Cenário B — sem idempotency_key, N `initial` paralelos
// ---------------------------------------------------------------------------
test("concorrência sem idem-key: N initial → 1 sucesso, N-1 conflitos, sem duplicatas", async () => {
  resetWorkerDocs();
  const N = 6;
  const stamp = Date.now();
  const mk = (i: number) => ({
    worker_id: WORKER_ID,
    document_type_id: ASO_DOCUMENT_TYPE_ID,
    operation: "initial",
    file_path: `${WORKER_ID}/${ASO_DOCUMENT_TYPE_ID}/${stamp}-${i}.pdf`,
    file_name: `aso-${stamp}-${i}.pdf`,
    file_size: 2048 + i,
    mime_type: "application/pdf",
    issued_at: isoToday(-1),
    document_number: `ASO-CONC-B-${i}`,
    issuing_authority: "Clínica E2E",
  });

  const outcomes = await Promise.all(
    Array.from({ length: N }, (_, i) => callRpc(apiRequest, mk(i))),
  );

  const successes = outcomes.filter((o) => o.ok) as Extract<RpcOutcome, { ok: true }>[];
  const failures = outcomes.filter((o) => !o.ok) as Extract<RpcOutcome, { ok: false }>[];

  expect(
    successes,
    `esperado exatamente 1 sucesso — obtidos: ${JSON.stringify(successes)}`,
  ).toHaveLength(1);
  expect(successes[0].idempotentHit).toBe(false);
  expect(failures).toHaveLength(N - 1);

  // Toda falha deve ser o conflito de unicidade da revisão vigente.
  for (const f of failures) {
    const haystack = `${f.message ?? ""} ${f.rawBody}`;
    expect(
      haystack.includes("current_revision_already_exists"),
      `falha inesperada: status=${f.status} code=${f.code} body=${f.rawBody}`,
    ).toBeTruthy();
  }

  // Zero duplicatas: exatamente uma revisão total e uma vigente.
  const { total, current, logs } = countRows();
  expect(total).toBe(1);
  expect(current).toBe(1);
  expect(logs).toBe(1);
});