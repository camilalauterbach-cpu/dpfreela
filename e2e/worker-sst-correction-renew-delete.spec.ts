// Q-025 — E2E: Substituir (correction) / Renovar mesma vigência / Excluir /
// Treinamento Interno sem duplicidade.
//
// Cobertura:
//  1. Substituir NR35 → operation='correction' → UPDATE in-place (mesmo id, count=1).
//  2. Renovar NR35 com datas idênticas → RPC rejeita com
//     'renewal_same_period_use_correction', mantém apenas 1 vigente.
//  3. Excluir certificado → delete_sst_revision marca deleted_at.
//  4. Salvar Treinamento Interno → linha aparece; nova tentativa mesmo tipo
//     é bloqueada por qualification_current_version_exists sem duplicar.
//
// Requer LOVABLE_BROWSER_AUTH_STATUS=injected + psql (PG* env).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, type Page } from "./fixtures/auth";

function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2] ?? "";
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadDotEnv();

function psql(sql: string): string {
  const raw = execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tAqc", sql], {
    encoding: "utf8",
    env: process.env,
  }).trim();
  return raw
    .split("\n")
    .filter((l) => !/^(INSERT|UPDATE|DELETE|SELECT|WITH)\s+\d/.test(l))
    .join("\n")
    .trim();
}
function psqlSafe(sql: string): void {
  try {
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tAqc", sql], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch { /* best-effort */ }
}

const NR35_TYPE_ID = "4a4dced4-1ce3-4561-b361-e0ee497bfa45";
const TREINAMENTO_INT_ID = "b67b402f-2b56-41ce-bdf8-44a522d26178";
const TREINAMENTO_INT_TESTID_SUFFIX = "TREINAMENTOINT";

const RUN_ID = `Q025-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const WORKER_NAME = `E2E ${RUN_ID}`;

const SEED_ISSUED = "2025-01-15";
const SEED_EXPIRES = "2027-01-15";

const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

function generateCpf(): string {
  const nine: number[] = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    let s = 0; for (let i = 0; i < base.length; i++) s += base[i] * (base.length + 1 - i);
    const mod = s % 11; return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = dv(nine);
  const d2 = dv([...nine, d1]);
  return [...nine, d1, d2].join("");
}

let WORKER_ID = "";
let SEED_QUAL_ID = "";
let SUBSTITUTED_ONCE = false;

interface RpcHit { url: string; payload: any; status: number; body: string }

async function collectRpc(page: Page, rx: RegExp): Promise<RpcHit[]> {
  const hits: RpcHit[] = [];
  page.on("response", async (res) => {
    if (!rx.test(res.url())) return;
    let payload: any = null;
    try { payload = JSON.parse(res.request().postData() || "null"); } catch { /* ignore */ }
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    hits.push({ url: res.url(), payload, status: res.status(), body });
  });
  return hits;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (status !== "injected") test.skip(true, `no injected auth (${status})`);
  if (!process.env.PGHOST) throw new Error("psql env (PGHOST etc.) ausente.");

  const cpf = generateCpf();
  WORKER_ID = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME.replace(/'/g, "''")}', '${cpf}') returning id`,
  );
  expect(WORKER_ID).toMatch(/^[0-9a-f-]{36}$/);
});

test.afterAll(() => {
  if (!WORKER_ID) return;
  psqlSafe(`delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}')`);
  psqlSafe(`delete from public.worker_sst_qualifications where worker_id='${WORKER_ID}'`);
  psqlSafe(`delete from public.worker_documents where worker_id='${WORKER_ID}'`);
  psqlSafe(`delete from public.workers where id='${WORKER_ID}'`);
});

async function openSstTab(page: Page) {
  await page.goto(`${BASE_URL}/workers/${WORKER_ID}?tab=sst`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("add-qualification-button")).toBeVisible({ timeout: 15_000 });
}

async function fillDrawerCommon(
  page: Page,
  drawer: ReturnType<Page["getByTestId"]>,
  opts: { issued: string; expires: string; provider?: string },
) {
  await drawer.locator('input[type="file"]').setInputFiles({
    name: `q025-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  });
  const dates = drawer.locator('input[type="date"]');
  await dates.first().fill(opts.issued);
  if ((await dates.count()) > 1) await dates.nth(1).fill(opts.expires);
  if (opts.provider) {
    const providerInput = drawer.locator('label:has-text("Instituição") + input');
    if (await providerInput.count()) await providerInput.fill(opts.provider);
  }
}

async function selectQualificationType(page: Page, drawer: ReturnType<Page["getByTestId"]>, matcher: RegExp) {
  await drawer.getByTestId("qualification-type-combobox").click();
  const option = page
    .locator('[data-testid^="qualification-type-option-"]')
    .filter({ hasText: matcher })
    .first();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
}

test("Cadastra NR35 inicial via UI (seed do fluxo)", async ({ authedPage: page }) => {
  test.setTimeout(90_000);
  await openSstTab(page);

  await page.getByTestId("add-qualification-button").click();
  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await selectQualificationType(page, drawer, /NR\s*-?\s*35/i);

  await fillDrawerCommon(page, drawer, {
    issued: SEED_ISSUED,
    expires: SEED_EXPIRES,
    provider: `Seed ${RUN_ID}`,
  });

  await drawer.getByTestId("save-qualification").click();
  await expect(drawer).toBeHidden({ timeout: 20_000 });

  SEED_QUAL_ID = psql(
    `select id from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${NR35_TYPE_ID}'
         and deleted_at is null and superseded_at is null`,
  );
  expect(SEED_QUAL_ID).toMatch(/^[0-9a-f-]{36}$/);
});

test("Substituir NR35 executa correction (UPDATE in-place, mesmo id, sem duplicar)", async ({ authedPage: page }) => {
  test.setTimeout(90_000);
  const hits = await collectRpc(page, /\/rest\/v1\/rpc\/register_sst_revision(\?|$)/);

  await openSstTab(page);

  // Abre menu de ações da linha NR35 → Substituir.
  const nrRow = page.getByRole("table").locator("tr", { hasText: /NR-?35/i }).first();
  await expect(nrRow).toBeVisible();
  await nrRow.getByRole("button").last().click(); // trigger MoreHorizontal
  await page.getByRole("menuitem", { name: /Substituir/i }).click();

  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await fillDrawerCommon(page, drawer, {
    issued: "2025-06-20",
    expires: "2027-06-20",
    provider: `Provider Correction ${RUN_ID}`,
  });

  await drawer.getByTestId("save-qualification").click();
  await expect(drawer).toBeHidden({ timeout: 20_000 });

  expect(hits.length).toBeGreaterThan(0);
  const last = hits[hits.length - 1];
  const inner = (last.payload?.payload ?? last.payload) as Record<string, unknown>;
  expect(inner.operation).toBe("correction");
  expect(inner.previous_qualification_id).toBe(SEED_QUAL_ID);
  expect(last.status).toBeLessThan(400);

  // DB: mesmo id, dados atualizados, exatamente 1 vigente para (worker, type).
  const stillOne = Number(psql(
    `select count(*) from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${NR35_TYPE_ID}'
         and deleted_at is null and superseded_at is null`,
  ));
  expect(stillOne).toBe(1);

  const row = psql(
    `select id || '|' || issued_at::text || '|' || provider_name
       from public.worker_sst_qualifications
      where id='${SEED_QUAL_ID}'`,
  );
  expect(row.startsWith(`${SEED_QUAL_ID}|2025-06-20|`)).toBe(true);
  expect(row).toContain("Provider Correction");
});

test("Renovar com datas idênticas rejeita com renewal_same_period_use_correction (sem duplicar)", async ({ authedPage: page }) => {
  test.setTimeout(90_000);
  const hits = await collectRpc(page, /\/rest\/v1\/rpc\/register_sst_revision(\?|$)/);

  await openSstTab(page);

  const nrRow = page.getByRole("table").locator("tr", { hasText: /NR-?35/i }).first();
  await expect(nrRow).toBeVisible();
  await nrRow.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: /Renovar/i }).click();

  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  // Repete exatamente as datas da vigência atual (definidas no Substituir acima).
  await fillDrawerCommon(page, drawer, { issued: "2025-06-20", expires: "2027-06-20" });

  await drawer.getByTestId("save-qualification").click();

  // Aguarda RPC concluir; drawer deve permanecer aberto (erro).
  await expect
    .poll(() => hits.length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const last = hits[hits.length - 1];
  expect(last.body).toContain("renewal_same_period_use_correction");
  await expect(drawer).toBeVisible();

  // Sem duplicidade no banco.
  const activeCount = Number(psql(
    `select count(*) from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${NR35_TYPE_ID}'
         and deleted_at is null and superseded_at is null`,
  ));
  expect(activeCount).toBe(1);

  // Fecha o drawer para não vazar estado entre testes.
  await page.keyboard.press("Escape");
});

test("Excluir certificado marca deleted_at e some da tabela", async ({ authedPage: page }) => {
  test.setTimeout(60_000);
  const hits = await collectRpc(page, /\/rest\/v1\/rpc\/delete_sst_revision(\?|$)/);

  await openSstTab(page);

  const nrRow = page.getByRole("table").locator("tr", { hasText: /NR-?35/i }).first();
  await expect(nrRow).toBeVisible();
  await nrRow.getByRole("button").last().click();
  await page.getByTestId("delete-qualification").click();

  // AlertDialog de confirmação — botão "Excluir".
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: /^Excluir$/i });
  await expect(confirm).toBeVisible();
  await confirm.click();

  await expect
    .poll(() => hits.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(hits[hits.length - 1].status).toBeLessThan(400);

  const deletedAt = psql(
    `select coalesce(deleted_at::text, '') from public.worker_sst_qualifications where id='${SEED_QUAL_ID}'`,
  );
  expect(deletedAt).not.toBe("");

  const active = Number(psql(
    `select count(*) from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${NR35_TYPE_ID}'
         and deleted_at is null and superseded_at is null`,
  ));
  expect(active).toBe(0);
});

test("Treinamento Interno: cria uma vez; segunda tentativa é bloqueada sem duplicar", async ({ authedPage: page }) => {
  test.setTimeout(120_000);
  const hits = await collectRpc(page, /\/rest\/v1\/rpc\/register_sst_revision(\?|$)/);

  // ---- 1ª criação: sucesso ----------------------------------------------
  await openSstTab(page);
  await page.getByTestId("add-qualification-button").click();
  let drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await selectQualificationType(page, drawer, /Treinamento\s+Interno/i);

  await drawer.getByTestId("training-type-select").selectOption("Inicial");
  await fillDrawerCommon(page, drawer, {
    issued: "2025-03-01",
    expires: "2027-03-01",
    provider: `Instituição ${RUN_ID}`,
  });
  await drawer.locator('input[inputmode="numeric"]').first().fill("8");

  await drawer.getByTestId("save-qualification").click();
  await expect(drawer).toBeHidden({ timeout: 20_000 });

  await expect
    .poll(() => Number(psql(
      `select count(*) from public.worker_sst_qualifications
         where worker_id='${WORKER_ID}' and document_type_id='${TREINAMENTO_INT_ID}'
           and deleted_at is null and superseded_at is null`,
    )), { timeout: 15_000 })
    .toBe(1);

  // ---- 2ª tentativa mesmo tipo: bloqueada -------------------------------
  const beforeCount = hits.length;
  await page.getByTestId("add-qualification-button").click();
  drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await selectQualificationType(page, drawer, /Treinamento\s+Interno/i);
  await drawer.getByTestId("training-type-select").selectOption("Inicial");
  await fillDrawerCommon(page, drawer, {
    issued: "2025-04-10",
    expires: "2027-04-10",
    provider: `Instituição B ${RUN_ID}`,
  });
  await drawer.locator('input[inputmode="numeric"]').first().fill("8");

  await drawer.getByTestId("save-qualification").click();

  await expect
    .poll(() => hits.length, { timeout: 20_000 })
    .toBeGreaterThan(beforeCount);
  const last = hits[hits.length - 1];
  expect(last.body).toMatch(/qualification_current_version_exists|additional_conflicts_with_current/);
  await expect(drawer).toBeVisible();

  // Sem duplicidade.
  const finalCount = Number(psql(
    `select count(*) from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${TREINAMENTO_INT_ID}'
         and deleted_at is null and superseded_at is null`,
  ));
  expect(finalCount).toBe(1);
});
