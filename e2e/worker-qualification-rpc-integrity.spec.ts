/**
 * Q-024.B-E2E — bateria autenticada T1..T16 para `register_sst_revision`.
 *
 * Regras:
 *  - Cada teste é serial (fullyParallel = false, workers = 1) porque
 *    todos operam sobre o mesmo worker E2E e mesmos document_type_ids.
 *  - Seeds e asserções diretas no banco vão por psql (mesmo sandbox);
 *    a mutação sob teste é sempre via RPC autenticada.
 *  - T17 (rollback com falha injetada) NÃO roda aqui: exige banco
 *    descartável e mecanismo de teste no schema, incompatível com o
 *    projeto operacional. Ver relatório final.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, request as pwRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  callRegisterSstRevision,
  describeOutcome,
  type RegisterSstRevisionOutcome,
  type RegisterSstRevisionPayload,
} from "./helpers/register-sst-revision";

// ---- .env → process.env (VITE_* vars não são inject. em Playwright) ------
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

// ---- psql helpers ---------------------------------------------------------
function psql(sql: string): string {
  return execFileSync("psql", ["-tAc", sql], {
    encoding: "utf8",
    env: process.env,
  }).trim();
}
function psqlRows(sql: string): string[][] {
  const out = psql(sql);
  if (!out) return [];
  return out.split("\n").map((r) => r.split("|"));
}

// ---- constantes -----------------------------------------------------------
const NR06_ID = "b0cac58b-571c-4206-afdd-3610994fa332";
const NR18_ID = "f310574b-3029-49f2-951f-1e9bd9ee419a";
const NR35_ID = "4a4dced4-1ce3-4561-b361-e0ee497bfa45";

const RUN_ID = `Q024B-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const WORKER_NAME = `E2E Q024B ${RUN_ID}`;
const WORKER_CPF = String(
  10000000000 + Math.floor(Math.random() * 89999999999),
); // valor sintético, não valida DV

let WORKER_ID = "";
let apiRequest: APIRequestContext;

// ---- setup ---------------------------------------------------------------
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (status !== "injected") {
    test.skip(true, `no injected auth (LOVABLE_BROWSER_AUTH_STATUS=${status})`);
  }
  if (!process.env.PGHOST) {
    throw new Error(
      "psql env (PGHOST etc.) ausente; teste requer acesso direto ao banco.",
    );
  }

  // seed worker isolado — a sanity de role fica implícita: a primeira RPC
  // do T1 falharia com `role_required` se o usuário injetado não tivesse
  // admin/manager/operator, e o cleanup por psql funcionaria mesmo assim.
  WORKER_ID = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME.replace(
      /'/g,
      "''",
    )}', '${WORKER_CPF}') returning id`,
  );
  expect(WORKER_ID).toMatch(/^[0-9a-f-]{36}$/);

  apiRequest = await pwRequest.newContext();
});

test.afterAll(async () => {
  if (!WORKER_ID) return;
  // limpeza total do worker E2E — inclui change_logs desta corrida
  psql(`
    with q as (
      select id from public.worker_sst_qualifications where worker_id = '${WORKER_ID}'
    )
    delete from public.change_logs
     where table_name = 'worker_sst_qualifications'
       and record_id in (select id from q)
  `);
  psql(
    `delete from public.worker_sst_qualifications where worker_id = '${WORKER_ID}'`,
  );
  psql(`delete from public.workers where id = '${WORKER_ID}'`);
  await apiRequest?.dispose();

  const residual = psql(
    `select count(*) from public.worker_sst_qualifications where worker_id = '${WORKER_ID}'`,
  );
  expect(residual, "cleanup: nenhuma qualif. residual").toBe("0");
  const worker = psql(
    `select count(*) from public.workers where id = '${WORKER_ID}'`,
  );
  expect(worker, "cleanup: worker E2E removido").toBe("0");
});

// ---- helpers de asserção -------------------------------------------------
function expectOk(
  outcome: RegisterSstRevisionOutcome,
  payload: RegisterSstRevisionPayload,
) {
  expect(
    outcome.ok,
    `RPC deveria ter sucesso — ${describeOutcome(outcome, payload)}`,
  ).toBeTruthy();
  if (!outcome.ok) throw new Error("unreachable");
  return outcome.data;
}
function expectErr(
  outcome: RegisterSstRevisionOutcome,
  payload: RegisterSstRevisionPayload,
  expectedCodeInMessage: string,
) {
  expect(
    outcome.ok,
    `RPC deveria ter falhado — ${describeOutcome(outcome, payload)}`,
  ).toBeFalsy();
  if (outcome.ok) throw new Error("unreachable");
  const haystack = `${outcome.message ?? ""} ${outcome.details ?? ""} ${outcome.rawBody}`;
  expect(
    haystack.includes(expectedCodeInMessage),
    `esperava "${expectedCodeInMessage}" em ${describeOutcome(outcome, payload)}`,
  ).toBeTruthy();
}
function countCurrent(docTypeId?: string): number {
  const where = docTypeId
    ? `and document_type_id = '${docTypeId}'`
    : "";
  return Number(
    psql(`
      select count(*) from public.worker_sst_qualifications
       where worker_id = '${WORKER_ID}'
         and superseded_at is null
         and deleted_at is null
         ${where}
    `),
  );
}
function totalRows(docTypeId?: string): number {
  const where = docTypeId ? `and document_type_id='${docTypeId}'` : "";
  return Number(
    psql(
      `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' ${where}`,
    ),
  );
}
function changeLogsFor(qualId: string): number {
  return Number(
    psql(`
      select count(*) from public.change_logs
       where table_name='worker_sst_qualifications' and record_id='${qualId}'
    `),
  );
}

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// =========================================================================
// T1 — create com document_type_id explícito
// =========================================================================
test("T1 create NR06 com document_type_id", async () => {
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "initial",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
    workload_hours: 8,
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  expect(out.document_type_id).toBe(NR06_ID);
  expect(out.document_type_code).toBe("NR06");
  expect(out.previous_qualification_id).toBeNull();
  expect(out.compatibility_input.source).toBe("document_type_id");
  expect(countCurrent(NR06_ID)).toBe(1);
  expect(changeLogsFor(out.qualification_id)).toBe(1);
});

// =========================================================================
// T2 — entrada legada por nr_code
// =========================================================================
test("T2 create NR35 via nr_code legado", async () => {
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    nr_code: "NR-35",
    operation: "initial",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  expect(out.document_type_id).toBe(NR35_ID);
  expect(out.compatibility_input.source).toBe("legacy_nr_code");
  expect(out.compatibility_mode).toBeTruthy();
  expect(countCurrent(NR35_ID)).toBe(1);
});

// =========================================================================
// T3 — UUID + código equivalentes
// =========================================================================
test("T3 create NR18 com UUID + nr_code equivalentes", async () => {
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR18_ID,
    nr_code: "NR18",
    operation: "initial",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  expect(out.compatibility_input.source).toBe("both_verified");
  expect(countCurrent(NR18_ID)).toBe(1);
  expect(countCurrent()).toBe(3); // NR06+NR35+NR18 vigentes simultâneas → T6
});

// =========================================================================
// T4 — UUID + código divergentes
// =========================================================================
test("T4 UUID NR18 + nr_code NR35 → mismatch", async () => {
  const before = totalRows();
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR18_ID,
    nr_code: "NR35",
    operation: "initial",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  const out = await callRegisterSstRevision(apiRequest, payload);
  expectErr(out, payload, "document_type_code_mismatch");
  expect(totalRows()).toBe(before);
});

// =========================================================================
// T5 — tipo ausente/desconhecido
// =========================================================================
test("T5 payload sem tipo → document_type_required", async () => {
  const before = totalRows();
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    operation: "initial",
    issued_at: isoToday(-1),
    validity_status: "unknown",
  };
  expectErr(
    await callRegisterSstRevision(apiRequest, payload),
    payload,
    "document_type_required",
  );

  const badUuid = "00000000-0000-0000-0000-000000000000";
  const payload2: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: badUuid,
    operation: "initial",
    issued_at: isoToday(-1),
    validity_status: "unknown",
  };
  expectErr(
    await callRegisterSstRevision(apiRequest, payload2),
    payload2,
    "unknown_document_type",
  );
  expect(totalRows()).toBe(before);
});

// =========================================================================
// T6 — múltiplas qualificações (validado incrementalmente por T1/T2/T3)
// =========================================================================
test("T6 três NRs vigentes coexistem", async () => {
  expect(countCurrent(NR06_ID)).toBe(1);
  expect(countCurrent(NR18_ID)).toBe(1);
  expect(countCurrent(NR35_ID)).toBe(1);
});

// =========================================================================
// T7 — create repetido → qualification_current_version_exists
// =========================================================================
test("T7 create repetido bloqueado", async () => {
  const before = totalRows();
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "initial",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  expectErr(
    await callRegisterSstRevision(apiRequest, payload),
    payload,
    "qualification_current_version_exists",
  );
  expect(totalRows()).toBe(before);
  expect(countCurrent(NR06_ID)).toBe(1);
});

// =========================================================================
// T8 — additional sem vigente (compat: cai para initial) — requer worker limpo
// =========================================================================
test("T8 additional sem vigente → initial (compat)", async () => {
  // Cria worker temporário isolado só para T8 (mantém invariante do worker principal)
  const tmpId = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME} T8', '${WORKER_CPF.slice(0, -2)}88') returning id`,
  );
  try {
    const payload: RegisterSstRevisionPayload = {
      worker_id: tmpId,
      document_type_id: NR06_ID,
      operation: "additional",
      issued_at: isoToday(-1),
      expires_at: isoToday(365),
      validity_status: "has_expiry",
    };
    const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
    expect(out.requested_revision_type).toBe("additional");
    expect(out.revision_type).toBe("initial");
    expect(out.previous_qualification_id).toBeNull();
    const currentCount = Number(
      psql(
        `select count(*) from public.worker_sst_qualifications where worker_id='${tmpId}' and superseded_at is null`,
      ),
    );
    expect(currentCount).toBe(1);
  } finally {
    psql(
      `delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${tmpId}')`,
    );
    psql(`delete from public.worker_sst_qualifications where worker_id='${tmpId}'`);
    psql(`delete from public.workers where id='${tmpId}'`);
  }
});

// =========================================================================
// T9 — additional com vigente → additional_conflicts_with_current
// =========================================================================
test("T9 additional com vigente bloqueado", async () => {
  const before = totalRows();
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "additional",
    issued_at: isoToday(-1),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  expectErr(
    await callRegisterSstRevision(apiRequest, payload),
    payload,
    "additional_conflicts_with_current",
  );
  expect(totalRows()).toBe(before);
});

// =========================================================================
// T10 — renewal com expected_current_qualification_id
// =========================================================================
test("T10 renewal com controle otimista OK", async () => {
  const beforeCurrent = psql(
    `select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}' and superseded_at is null`,
  );
  expect(beforeCurrent).toMatch(/^[0-9a-f-]{36}$/);

  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "renewal",
    expected_current_qualification_id: beforeCurrent,
    issued_at: isoToday(),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  expect(out.previous_qualification_id).toBe(beforeCurrent);
  expect(out.revision_type).toBe("renewal");
  expect(countCurrent(NR06_ID)).toBe(1);

  // supersedes_id e superseded_at
  const chain = psqlRows(`
    select id::text, coalesce(supersedes_id::text,'null'),
           case when superseded_at is null then 'null' else 'ts' end
      from public.worker_sst_qualifications
     where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}'
     order by created_at
  `);
  expect(chain.length).toBe(2);
  expect(chain[0][2]).toBe("ts");
  expect(chain[1][1]).toBe(chain[0][0]);
  expect(chain[1][2]).toBe("null");
  expect(changeLogsFor(out.qualification_id)).toBe(1);
});

// =========================================================================
// T11 — replacement
// =========================================================================
test("T11 replacement preserva cadeia", async () => {
  const cur = psql(
    `select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}' and superseded_at is null`,
  );
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "replacement",
    expected_current_qualification_id: cur,
    issued_at: isoToday(),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
    revision_reason: "erro no anterior",
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  expect(out.revision_type).toBe("replacement");
  const reason = psql(
    `select revision_reason::text from public.worker_sst_qualifications where id='${out.qualification_id}'`,
  );
  expect(reason).toBe("replaced");
  expect(countCurrent(NR06_ID)).toBe(1);
});

// =========================================================================
// T12 — correction
// =========================================================================
test("T12 correction registrada como corrected", async () => {
  const cur = psql(
    `select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}' and superseded_at is null`,
  );
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "correction",
    expected_current_qualification_id: cur,
    issued_at: isoToday(),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
    revision_reason: "typo na data",
  };
  const out = expectOk(await callRegisterSstRevision(apiRequest, payload), payload);
  const reason = psql(
    `select revision_reason::text from public.worker_sst_qualifications where id='${out.qualification_id}'`,
  );
  expect(reason).toBe("corrected");
  expect(out.revision_type).toBe("replacement"); // físico documentado
  expect(out.requested_revision_type).toBe("correction");
  expect(countCurrent(NR06_ID)).toBe(1);
});

// =========================================================================
// T13 — expected_current_qualification_id obsoleto
// =========================================================================
test("T13 stale_current_qualification quando expected é o antigo", async () => {
  // pega o CURRENT B e a revisão anterior A
  const rows = psqlRows(`
    select id::text, case when superseded_at is null then 'cur' else 'old' end
      from public.worker_sst_qualifications
     where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}'
     order by created_at
  `);
  const a = rows.find((r) => r[1] === "old")?.[0];
  const b = rows.find((r) => r[1] === "cur")?.[0];
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();

  const before = totalRows(NR06_ID);
  const payload: RegisterSstRevisionPayload = {
    worker_id: WORKER_ID,
    document_type_id: NR06_ID,
    operation: "renewal",
    expected_current_qualification_id: a, // stale
    issued_at: isoToday(),
    expires_at: isoToday(365),
    validity_status: "has_expiry",
  };
  const out = await callRegisterSstRevision(apiRequest, payload);
  expectErr(out, payload, "stale_current_qualification");
  // B continua vigente
  const curNow = psql(
    `select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}' and superseded_at is null`,
  );
  expect(curNow).toBe(b);
  expect(totalRows(NR06_ID)).toBe(before);
});

// =========================================================================
// T14 — concorrência create/create no mesmo tipo
// =========================================================================
test("T14 concorrência create/create → 1 sucesso + 1 conflito", async () => {
  // seed limpo em worker temporário
  const tmp = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME} T14', '${WORKER_CPF.slice(0, -2)}14') returning id`,
  );
  try {
    const mk = (): RegisterSstRevisionPayload => ({
      worker_id: tmp,
      document_type_id: NR35_ID,
      operation: "initial",
      issued_at: isoToday(),
      expires_at: isoToday(365),
      validity_status: "has_expiry",
    });
    const [a, b] = await Promise.all([
      callRegisterSstRevision(apiRequest, mk()),
      callRegisterSstRevision(apiRequest, mk()),
    ]);
    const successes = [a, b].filter((r) => r.ok).length;
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes, `${describeOutcome(a, mk())} / ${describeOutcome(b, mk())}`).toBe(1);
    expect(failures.length).toBe(1);
    // uma vigente
    const cur = Number(
      psql(
        `select count(*) from public.worker_sst_qualifications where worker_id='${tmp}' and superseded_at is null`,
      ),
    );
    expect(cur).toBe(1);
  } finally {
    psql(
      `delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${tmp}')`,
    );
    psql(`delete from public.worker_sst_qualifications where worker_id='${tmp}'`);
    psql(`delete from public.workers where id='${tmp}'`);
  }
});

// =========================================================================
// T15 — concorrência tipos diferentes (ambas sucedem)
// =========================================================================
test("T15 concorrência NR06 vs NR18 em worker novo", async () => {
  const tmp = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME} T15', '${WORKER_CPF.slice(0, -2)}15') returning id`,
  );
  try {
    const p06: RegisterSstRevisionPayload = {
      worker_id: tmp,
      document_type_id: NR06_ID,
      operation: "initial",
      issued_at: isoToday(),
      expires_at: isoToday(365),
      validity_status: "has_expiry",
    };
    const p18: RegisterSstRevisionPayload = { ...p06, document_type_id: NR18_ID };
    const [r06, r18] = await Promise.all([
      callRegisterSstRevision(apiRequest, p06),
      callRegisterSstRevision(apiRequest, p18),
    ]);
    expectOk(r06, p06);
    expectOk(r18, p18);
    expect(
      Number(
        psql(
          `select count(*) from public.worker_sst_qualifications where worker_id='${tmp}' and superseded_at is null`,
        ),
      ),
    ).toBe(2);
  } finally {
    psql(
      `delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${tmp}')`,
    );
    psql(`delete from public.worker_sst_qualifications where worker_id='${tmp}'`);
    psql(`delete from public.workers where id='${tmp}'`);
  }
});

// =========================================================================
// T16 — concorrência renew/renew mesmo expected_current_id
// =========================================================================
test("T16 renew/renew concorrentes → 1 sucesso + 1 stale", async () => {
  // seed: worker + NR06 vigente
  const tmp = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME} T16', '${WORKER_CPF.slice(0, -2)}16') returning id`,
  );
  try {
    const seedPayload: RegisterSstRevisionPayload = {
      worker_id: tmp,
      document_type_id: NR06_ID,
      operation: "initial",
      issued_at: isoToday(-1),
      expires_at: isoToday(365),
      validity_status: "has_expiry",
    };
    const seed = expectOk(
      await callRegisterSstRevision(apiRequest, seedPayload),
      seedPayload,
    );
    const expectedId = seed.qualification_id;

    const mk = (): RegisterSstRevisionPayload => ({
      worker_id: tmp,
      document_type_id: NR06_ID,
      operation: "renewal",
      expected_current_qualification_id: expectedId,
      issued_at: isoToday(),
      expires_at: isoToday(365),
      validity_status: "has_expiry",
    });
    const [a, b] = await Promise.all([
      callRegisterSstRevision(apiRequest, mk()),
      callRegisterSstRevision(apiRequest, mk()),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    const failMsg = `${(failures[0] as {rawBody?:string}).rawBody ?? ""}`;
    expect(
      failMsg.includes("stale_current_qualification") ||
        failMsg.includes("previous_chain_mismatch") ||
        failMsg.includes("invariant_violation"),
      `falha esperada como stale — recebido ${failMsg}`,
    ).toBeTruthy();

    // apenas UMA filha nova, sem ramificação
    const rows = psqlRows(`
      select id::text, coalesce(supersedes_id::text,'null')
        from public.worker_sst_qualifications
       where worker_id='${tmp}' and document_type_id='${NR06_ID}'
       order by created_at
    `);
    expect(rows.length).toBe(2);
    expect(rows[1][1]).toBe(rows[0][0]);
    expect(
      Number(
        psql(
          `select count(*) from public.worker_sst_qualifications where worker_id='${tmp}' and document_type_id='${NR06_ID}' and superseded_at is null`,
        ),
      ),
    ).toBe(1);
  } finally {
    psql(
      `delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${tmp}')`,
    );
    psql(`delete from public.worker_sst_qualifications where worker_id='${tmp}'`);
    psql(`delete from public.workers where id='${tmp}'`);
  }
});

// =========================================================================
// View current alinhada com predicado canônico (subset dos IDs E2E)
// =========================================================================
test("view worker_sst_qualifications_current equivalente ao predicado canônico", async () => {
  const diff = psql(`
    with pred as (
      select id from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and superseded_at is null and deleted_at is null
    ), view_ as (
      select id from public.worker_sst_qualifications_current
       where worker_id='${WORKER_ID}'
    )
    select (select count(*) from pred) || '|' || (select count(*) from view_) || '|' ||
      (select count(*) from ((select id from pred) except (select id from view_)) x) || '|' ||
      (select count(*) from ((select id from view_) except (select id from pred)) x)
  `);
  // pred=view=3; symmetric diff = 0
  const [pred, view, ab, ba] = diff.split("|");
  expect(pred).toBe(view);
  expect(ab).toBe("0");
  expect(ba).toBe("0");
});