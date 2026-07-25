// Q-024-D-UI-MULTIPLE — E2E autenticado: fluxo múltiplo NR + roteamento ASO.
//
// Cobre o gate funcional:
//   1. Adicionar NR18 → "Salvar e adicionar outra" → drawer permanece aberto
//      e formulário limpo (sem tipo selecionado).
//   2. Adicionar NR06 → "Salvar" (final) → drawer fecha.
//   3. Ambas as qualificações aparecem na tabela sem que uma bloqueie a outra.
//   4. Reabrir drawer, selecionar ASO → o fluxo entra em `flowBlocked` e o
//      botão "Gerenciar na aba Documentos" navega para
//      `?tab=documentos&document_type_id=<ASO_ID>` e o painel canônico de
//      revisão (`WorkerDocumentRevisionPanel`) é montado.
//
// Requisitos de ambiente:
//   - LOVABLE_BROWSER_AUTH_STATUS=injected (perfil admin/manager/operator).
//   - psql configurado (PGHOST etc.) para seed + cleanup do worker E2E.
//
// Isolamento:
//   - Um worker novo é criado por execução (CPF sintético válido). O cleanup
//     é best-effort porque change_logs pode ser append-only para o role.

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

// ---- psql helpers ---------------------------------------------------------
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

// ---- constantes -----------------------------------------------------------
const NR06_ID = "b0cac58b-571c-4206-afdd-3610994fa332";
const NR18_ID = "f310574b-3029-49f2-951f-1e9bd9ee419a";
const ASO_ID = "9264e69e-401a-406c-a5a1-c3dc6ca16f98";

const RUN_ID = `Q024UI-${Date.now().toString(36)}-${Math.random()
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

// PDF mínimo válido (%PDF-1.4 header + %%EOF). ~40 bytes.
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

test("adiciona NR18 + NR06 sem bloqueio mútuo e roteia ASO para Documentos", async ({ authedPage: page }) => {
  test.setTimeout(90_000);

  await page.goto(`${BASE_URL}/workers/${WORKER_ID}?tab=sst`, {
    waitUntil: "domcontentloaded",
  });

  // Painel de qualificações deve estar visível (KPIs + tabela vazia).
  const addBtn = page.getByTestId("add-qualification-button");
  await expect(addBtn).toBeVisible({ timeout: 15_000 });

  // ---- 1) NR18: Salvar e adicionar outra --------------------------------
  await addBtn.click();
  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("qualification-type-combobox").click();
  await page.getByTestId("qualification-type-option-nr18").click();

  // Upload do PDF sintético.
  await drawer
    .locator('input[type="file"]')
    .setInputFiles({
      name: "nr18.pdf",
      mimeType: "application/pdf",
      buffer: TINY_PDF,
    });

  // Data de realização — o vencimento é calculado automaticamente pelo
  // defaultValidityDays do catálogo. Se o tipo não tiver default, o botão
  // Salvar permanecerá desabilitado e o teste falhará com mensagem clara.
  await drawer.locator('input[type="date"]').first().fill(isoToday(-1));

  const saveAddAnother = drawer.getByTestId("save-and-add-another");
  await expect(saveAddAnother).toBeEnabled({ timeout: 10_000 });
  await saveAddAnother.click();

  // Drawer permanece aberto; combobox volta ao estado vazio ("Selecione…").
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  await expect(saveAddAnother).toBeDisabled({ timeout: 15_000 }); // limpou tipo/arquivo/data
  await expect(
    drawer.getByTestId("qualification-type-combobox"),
  ).toContainText(/Selecione/i);

  // Confirma no banco: NR18 vigente registrada.
  await expect
    .poll(
      () =>
        Number(
          psql(
            `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR18_ID}' and superseded_at is null and deleted_at is null`,
          ),
        ),
      { timeout: 10_000 },
    )
    .toBe(1);

  // ---- 2) NR06: Salvar (fecha o drawer) ---------------------------------
  await drawer.getByTestId("qualification-type-combobox").click();
  await page.getByTestId("qualification-type-option-nr06").click();

  await drawer
    .locator('input[type="file"]')
    .setInputFiles({
      name: "nr06.pdf",
      mimeType: "application/pdf",
      buffer: TINY_PDF,
    });
  await drawer.locator('input[type="date"]').first().fill(isoToday(-1));

  const saveFinal = drawer.getByTestId("save-qualification");
  await expect(saveFinal).toBeEnabled({ timeout: 10_000 });
  await saveFinal.click();

  // Drawer fecha após "Salvar".
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  await expect
    .poll(
      () =>
        Number(
          psql(
            `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${NR06_ID}' and superseded_at is null and deleted_at is null`,
          ),
        ),
      { timeout: 10_000 },
    )
    .toBe(1);

  // Ambas aparecem na tabela — nenhuma bloqueia a outra.
  const table = page.getByRole("table");
  await expect(table).toContainText("NR18");
  await expect(table).toContainText("NR06");

  // ---- 3) ASO: roteamento para a aba Documentos -------------------------
  await page.getByTestId("add-qualification-button").click();
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("qualification-type-combobox").click();
  await page.getByTestId("qualification-type-option-aso").click();

  // Fluxo bloqueado → aparece o botão canônico dentro do drawer.
  const manageBtn = drawer.getByTestId("drawer-manage-in-documents");
  await expect(manageBtn).toBeVisible({ timeout: 10_000 });

  await manageBtn.click();

  // Navegou para a aba Documentos com o document_type_id do ASO na URL.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("tab"), { timeout: 10_000 })
    .toBe("documentos");
  expect(new URL(page.url()).searchParams.get("document_type_id")).toBe(ASO_ID);

  // O painel canônico de revisão é montado.
  await expect(page.getByText("Revisão vigente")).toBeVisible({ timeout: 15_000 });

  // Drawer foi fechado durante a navegação.
  await expect(drawer).toBeHidden();
});