// Q-025 — E2E: Após Excluir certificado, KPIs (Vencendo/Válidas), status
// e qualificação vigente são recalculados imediatamente na UI.
//
// Cenário:
//   1. Cria trabalhador + cadastra NR35 com expiração em +15 dias (→ "Vencendo").
//   2. Captura KPIs iniciais e confirma linha visível com status "Vencendo".
//   3. Aciona "Excluir certificado" e confirma.
//   4. Aguarda invalidação de cache e confirma:
//        - KPI "Vencendo" decrementa em 1;
//        - KPI "Válidas" permanece igual;
//        - Linha some da tabela;
//        - deleted_at gravado no banco;
//        - Logs estruturados `[sst-delete]` emitidos com mesmo traceId.
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
  } catch { /* best-effort */ }
}

const NR35_TYPE_ID = "4a4dced4-1ce3-4561-b361-e0ee497bfa45";
const RUN_ID = `Q025DEL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const WORKER_NAME = `E2E ${RUN_ID}`;
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

function generateCpf(): string {
  const nine = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    let s = 0; for (let i = 0; i < base.length; i++) s += base[i] * (base.length + 1 - i);
    const mod = s % 11; return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = dv(nine);
  const d2 = dv([...nine, d1]);
  return [...nine, d1, d2].join("");
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let WORKER_ID = "";
let QUAL_ID = "";

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
  // Aguarda KPIs carregarem.
  await expect(page.getByTestId("kpi-expiring-value")).toBeVisible({ timeout: 15_000 });
}

async function readKpis(page: Page) {
  const val = async (tid: string) =>
    Number((await page.getByTestId(tid).textContent())?.trim() || "0");
  return {
    expired: await val("kpi-expired-value"),
    expiring: await val("kpi-expiring-value"),
    valid: await val("kpi-valid-value"),
    pending: await val("kpi-pending-docs-value"),
  };
}

test("Cadastra NR35 com validade em 15 dias (status 'Vencendo')", async ({ authedPage: page }) => {
  test.setTimeout(90_000);
  await openSstTab(page);

  await page.getByTestId("add-qualification-button").click();
  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("qualification-type-combobox").click();
  const opt = page.locator('[data-testid^="qualification-type-option-"]')
    .filter({ hasText: /NR\s*-?\s*35/i }).first();
  await opt.waitFor({ state: "visible", timeout: 15_000 });
  await opt.click();

  await drawer.locator('input[type="file"]').setInputFiles({
    name: `q025del-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  });
  const dates = drawer.locator('input[type="date"]');
  await dates.first().fill(isoDaysFromNow(-30));       // issued 30 dias atrás
  await dates.nth(1).fill(isoDaysFromNow(15));         // expires em 15 dias

  await drawer.getByTestId("save-qualification").click();
  await expect(drawer).toBeHidden({ timeout: 20_000 });

  QUAL_ID = psql(
    `select id from public.worker_sst_qualifications
       where worker_id='${WORKER_ID}' and document_type_id='${NR35_TYPE_ID}'
         and deleted_at is null and superseded_at is null`,
  );
  expect(QUAL_ID).toMatch(/^[0-9a-f-]{36}$/);
});

test("Excluir recalcula KPIs, remove linha e emite logs estruturados", async ({ authedPage: page }) => {
  test.setTimeout(90_000);

  // Coleta console.info/error com prefixo [sst-delete].
  const logs: Array<{ level: string; text: string }> = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[sst-delete]")) logs.push({ level: msg.type(), text });
  });

  await openSstTab(page);

  // Estado inicial esperado: NR35 aparece como "Vencendo".
  const nrRow = page.getByRole("table").locator("tr", { hasText: /NR-?35/i }).first();
  await expect(nrRow).toBeVisible();
  await expect(nrRow).toContainText(/Vencendo/i);

  const before = await readKpis(page);
  expect(before.expiring).toBeGreaterThanOrEqual(1);

  // Executa a exclusão.
  await nrRow.getByRole("button").last().click();
  await page.getByTestId("delete-qualification").click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: /^Excluir$/i });
  await expect(confirm).toBeVisible();
  await confirm.click();

  // Toast confirma sucesso.
  await expect(page.getByText("Certificado excluído.")).toBeVisible({ timeout: 15_000 });

  // Banco: deleted_at gravado.
  await expect
    .poll(() => psql(`select coalesce(deleted_at::text,'') from public.worker_sst_qualifications where id='${QUAL_ID}'`),
          { timeout: 10_000 })
    .not.toBe("");

  // UI: linha some.
  await expect(nrRow).toBeHidden({ timeout: 15_000 });

  // KPIs recalculam imediatamente após invalidação de cache.
  await expect
    .poll(async () => (await readKpis(page)).expiring, { timeout: 15_000 })
    .toBe(before.expiring - 1);

  const after = await readKpis(page);
  expect(after.valid).toBe(before.valid);
  expect(after.expired).toBe(before.expired);

  // Logs estruturados: start, rpc_ok, caches_invalidated com mesmo traceId.
  const start = logs.find((l) => l.text.includes("[sst-delete] start"));
  const okLog = logs.find((l) => l.text.includes("[sst-delete] rpc_ok"));
  const inv = logs.find((l) => l.text.includes("[sst-delete] caches_invalidated"));
  expect(start, `esperado log start, obtive: ${JSON.stringify(logs)}`).toBeTruthy();
  expect(okLog).toBeTruthy();
  expect(inv).toBeTruthy();

  const traceMatch = /del-[0-9a-f]{8}-[0-9a-z]+/;
  const startTrace = start!.text.match(traceMatch)?.[0];
  expect(startTrace).toBeTruthy();
  expect(okLog!.text).toContain(startTrace!);
  expect(inv!.text).toContain(startTrace!);
});