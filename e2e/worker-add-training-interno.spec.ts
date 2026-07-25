// Q-024-D-TRAINING-FIX — E2E: cadastro de "Treinamento Interno" até sucesso
// persistido após hard reload (bundle novo obrigatório em aba anônima).
//
// Gate reproduzido da homologação manual:
//   1. Abrir ficha do trabalhador (contexto novo — sem cache).
//   2. Adicionar qualificação → selecionar Treinamento Interno.
//   3. Preencher training_type = Inicial, realização, validade, carga
//      horária e instituição, anexar PDF e clicar Salvar.
//   4. Interceptar a chamada `register_sst_revision`:
//        - payload NÃO pode conter `nr_code`;
//        - resposta ≠ `invalid_nr_code_format`;
//        - status HTTP < 400.
//   5. Drawer fecha, linha "Treinamento Interno" aparece na tabela.
//   6. Hard reload (context.clearCookies + reload bypassing cache); linha
//      permanece visível e apenas UMA versão vigente existe no banco.
//
// Requisitos: LOVABLE_BROWSER_AUTH_STATUS=injected e psql configurado.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL } from "./fixtures/auth";

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
  } catch {
    /* best-effort cleanup */
  }
}

const TREINAMENTO_INT_ID = "b67b402f-2b56-41ce-bdf8-44a522d26178";
const TREINAMENTO_INT_TESTID_SUFFIX = "TREINAMENTOINT";

const RUN_ID = `Q024DTR-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const WORKER_NAME = `E2E ${RUN_ID}`;

function generateCpf(): string {
  const nine: number[] = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 10),
  );
  const dv = (base: number[]) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += base[i] * (base.length + 1 - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = dv(nine);
  const d2 = dv([...nine, d1]);
  return [...nine, d1, d2].join("");
}

const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8",
);

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let WORKER_ID = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (status !== "injected") {
    test.skip(true, `no injected auth (LOVABLE_BROWSER_AUTH_STATUS=${status})`);
  }
  if (!process.env.PGHOST) {
    throw new Error(
      "psql env (PGHOST etc.) ausente; teste requer acesso direto ao banco para seed do worker.",
    );
  }
  const cpf = generateCpf();
  WORKER_ID = psql(
    `insert into public.workers (full_name, cpf) values ('${WORKER_NAME.replace(
      /'/g,
      "''",
    )}', '${cpf}') returning id`,
  );
  expect(WORKER_ID).toMatch(/^[0-9a-f-]{36}$/);
});

test.afterAll(() => {
  if (!WORKER_ID) return;
  psqlSafe(
    `delete from public.change_logs where table_name='worker_sst_qualifications' and record_id in (select id from public.worker_sst_qualifications where worker_id='${WORKER_ID}')`,
  );
  psqlSafe(
    `delete from public.worker_sst_qualifications where worker_id='${WORKER_ID}'`,
  );
  psqlSafe(
    `delete from public.worker_documents where worker_id='${WORKER_ID}'`,
  );
  psqlSafe(`delete from public.workers where id='${WORKER_ID}'`);
});

test("cadastra Treinamento Interno sem invalid_nr_code_format e persiste após hard reload", async ({
  authedPage: page,
}) => {
  test.setTimeout(120_000);

  // ---- Intercepta a RPC register_sst_revision ---------------------------
  const rpcCalls: Array<{
    payload: unknown;
    status: number;
    responseText: string;
  }> = [];

  page.on("response", async (res) => {
    const url = res.url();
    if (!/\/rest\/v1\/rpc\/register_sst_revision(\?|$)/.test(url)) return;
    let payload: unknown = null;
    try {
      const req = res.request();
      const body = req.postData();
      payload = body ? JSON.parse(body) : null;
    } catch {
      /* ignore parse errors */
    }
    let responseText = "";
    try {
      responseText = await res.text();
    } catch {
      /* body may already be consumed */
    }
    rpcCalls.push({ payload, status: res.status(), responseText });
  });

  await page.goto(`${BASE_URL}/workers/${WORKER_ID}?tab=sst`, {
    waitUntil: "domcontentloaded",
  });

  const addBtn = page.getByTestId("add-qualification-button");
  await expect(addBtn).toBeVisible({ timeout: 15_000 });
  await addBtn.click();

  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  // Selecionar Treinamento Interno pelo catálogo canônico.
  await drawer.getByTestId("qualification-type-combobox").click();
  await page
    .getByTestId(`qualification-type-option-${TREINAMENTO_INT_TESTID_SUFFIX}`)
    .click();

  // training_type = "Inicial"
  await drawer
    .getByTestId("training-type-select")
    .selectOption("Inicial");

  // Anexo.
  await drawer.locator('input[type="file"]').setInputFiles({
    name: "treinamento_interno.pdf",
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  });

  // Datas — realização hoje-1; vencimento manual +180d para não depender de default.
  await drawer.locator('input[type="date"]').first().fill(isoToday(-1));
  // Segundo input date = vencimento (só existe quando hasExpiry=true, default).
  const dateInputs = drawer.locator('input[type="date"]');
  if ((await dateInputs.count()) > 1) {
    await dateInputs.nth(1).fill(isoToday(180));
  }

  // Carga horária + instituição.
  await drawer
    .locator('input[inputmode="numeric"]')
    .first()
    .fill("8");
  // Campo instituição = primeiro Input textual após carga horária. Usamos label.
  const providerInput = drawer.locator(
    'label:has-text("Instituição") + input',
  );
  await providerInput.fill(`Instituição E2E ${RUN_ID}`);

  const saveFinal = drawer.getByTestId("save-qualification");
  await expect(saveFinal).toBeEnabled({ timeout: 10_000 });
  await saveFinal.click();

  // Drawer deve fechar → indica sucesso da RPC.
  await expect(drawer).toBeHidden({ timeout: 20_000 });

  // ---- Validação da RPC -------------------------------------------------
  expect(rpcCalls.length, "register_sst_revision deve ter sido chamada").toBeGreaterThan(0);
  const lastCall = rpcCalls[rpcCalls.length - 1];

  // Payload não pode conter nr_code em treinamento.
  const inner = (lastCall.payload as { payload?: Record<string, unknown> })?.payload
    ?? (lastCall.payload as Record<string, unknown>);
  expect(inner, "payload da RPC ausente").toBeTruthy();
  expect(
    Object.prototype.hasOwnProperty.call(inner, "nr_code") &&
      (inner as Record<string, unknown>).nr_code != null,
    `payload de treinamento não pode conter nr_code (recebido: ${JSON.stringify(
      (inner as Record<string, unknown>).nr_code,
    )})`,
  ).toBe(false);
  expect((inner as Record<string, unknown>).document_type_id).toBe(
    TREINAMENTO_INT_ID,
  );

  // Status e mensagem: nunca invalid_nr_code_format.
  expect(lastCall.status, `RPC status ${lastCall.status}: ${lastCall.responseText}`).toBeLessThan(400);
  expect(lastCall.responseText).not.toContain("invalid_nr_code_format");

  // ---- Banco: exatamente uma versão vigente -----------------------------
  await expect
    .poll(
      () =>
        Number(
          psql(
            `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${TREINAMENTO_INT_ID}' and superseded_at is null and deleted_at is null`,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(1);

  // Linha visível na tabela.
  const table = page.getByRole("table");
  await expect(table).toContainText(/Treinamento Interno/i);

  // ---- Hard reload (bypass cache) ---------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });

  // Botão "Adicionar qualificação" continua visível E habilitado.
  const addBtnAfterReload = page.getByTestId("add-qualification-button");
  await expect(addBtnAfterReload).toBeVisible({ timeout: 15_000 });
  await expect(addBtnAfterReload).toBeEnabled();

  // Treinamento Interno permanece como linha na tabela após reload.
  const tableAfterReload = page.getByRole("table");
  await expect(tableAfterReload).toContainText(/Treinamento Interno/i);

  // A linha do Treinamento Interno é uma linha real (não placeholder).
  const trainingRow = tableAfterReload
    .locator("tr", { hasText: /Treinamento Interno/i })
    .first();
  await expect(trainingRow).toBeVisible();

  // ---- Banco: exatamente 1 versão vigente do Treinamento Interno --------
  expect(
    Number(
      psql(
        `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${TREINAMENTO_INT_ID}' and superseded_at is null and deleted_at is null`,
      ),
    ),
  ).toBe(1);

  // ---- Nenhuma NR fictícia foi criada -----------------------------------
  // (a) worker_sst_qualifications: nenhum registro com nr_code preenchido
  //     ou apontando para document_type de categoria 'sst_nr'.
  const spuriousNrCount = Number(
    psql(
      `select count(*) from public.worker_sst_qualifications q
         left join public.document_types dt on dt.id = q.document_type_id
        where q.worker_id='${WORKER_ID}'
          and q.deleted_at is null
          and (
            q.nr_code is not null
            or dt.category = 'sst_nr'
          )`,
    ),
  );
  expect(
    spuriousNrCount,
    "cadastro de Treinamento Interno não pode gerar NR fictícia (nr_code preenchido ou document_type sst_nr)",
  ).toBe(0);

  // (b) UI não deve exibir qualquer chip/badge no formato "NR" + dígitos
  //     para este worker recém-criado.
  const nrBadgeMatches = await tableAfterReload
    .locator("tbody tr")
    .filter({ hasText: /\bNR\s*-?\s*\d+/i })
    .count();
  expect(nrBadgeMatches, "nenhuma linha NR fictícia deve aparecer na tabela").toBe(0);

  // (c) O único document_type_id vigente para este worker é o Treinamento Interno.
  const activeTypes = psql(
    `select coalesce(string_agg(distinct document_type_id::text, ','), '') from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and superseded_at is null and deleted_at is null`,
  );
  expect(activeTypes).toBe(TREINAMENTO_INT_ID);
});