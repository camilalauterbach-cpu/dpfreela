// Q-024 — E2E: document_type NÃO-NR (ASO e demais categorias não aceitas)
// nunca exibe jargão técnico no cadastro; sempre mostra mensagem humana.
//
// Cobre duas superfícies do contrato:
//   (A) UI — ao selecionar um tipo ASO no drawer, o painel de roteamento
//       aparece com o texto "aba Documentos", o botão Salvar fica
//       desabilitado e nenhuma string técnica (duplicate/unique/23505/
//       SQLSTATE/uq_worker/PGRST/PL/pgSQL) é renderizada.
//   (B) Backend — chamando `register_sst_revision` diretamente com um
//       document_type_id de categoria sst_aso, a resposta é um código de
//       erro canônico bem definido (não expõe SQL cru); e o mesmo vale
//       para tipos genéricos (Exame Toxicológico).
//
// Requisitos: LOVABLE_BROWSER_AUTH_STATUS=injected + acesso psql para
// seed do trabalhador descartável.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL } from "./fixtures/auth";

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
  const nine = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
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

// Regex universal — qualquer match dispara falha: jamais deve chegar ao user.
const TECHNICAL_JARGON =
  /duplicate key|unique constraint|check constraint|foreign key|not[- ]null constraint|violates|SQLSTATE|ERRCODE|\b2[23]\d{3}\b|\b40\d{3}\b|\b42P?\d{2,3}\b|uq_worker_sst|PGRST\d+|PL\/pgSQL|CONTEXT:|HINT:|DETAIL:|TypeError|ReferenceError|pg_[a-z_]+|pq:\s/i;

const RUN_ID = `Q024NONNR-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const WORKER_NAME = `E2E ${RUN_ID}`;

let WORKER_ID = "";
let ASO_TYPE_ID = "";
let OTHER_NON_NR_TYPE_ID = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (status !== "injected") {
    test.skip(true, `no injected auth (LOVABLE_BROWSER_AUTH_STATUS=${status})`);
  }
  if (!process.env.PGHOST) {
    throw new Error("psql env ausente — teste requer PGHOST para seed.");
  }

  // Resolve document_type_ids reais do catálogo: um ASO e um genérico não-NR.
  ASO_TYPE_ID = psql(
    `select id from public.document_types where category='sst_aso' and is_active=true order by code limit 1`,
  );
  expect(ASO_TYPE_ID, "catálogo precisa expor pelo menos um ASO ativo").toMatch(
    /^[0-9a-f-]{36}$/,
  );

  OTHER_NON_NR_TYPE_ID = psql(
    `select id from public.document_types
       where category not in ('sst_nr','training','sst_aso')
         and is_active=true
       order by code limit 1`,
  );
  // Pode não existir — nesse caso o segundo cenário de RPC é ignorado.

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
  psqlSafe(`delete from public.worker_documents where worker_id='${WORKER_ID}'`);
  psqlSafe(`delete from public.workers where id='${WORKER_ID}'`);
});

// (A) UI ---------------------------------------------------------------------
test("drawer: ASO exibe roteamento humano e não expõe jargão técnico", async ({
  authedPage: page,
}) => {
  test.setTimeout(60_000);

  await page.goto(`${BASE_URL}/workers/${WORKER_ID}?tab=sst`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("add-qualification-button").click();
  const drawer = page.getByTestId("sst-certificate-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("qualification-type-combobox").click();
  // Filtra a lista para garantir renderização mesmo em catálogos grandes.
  const search = page.getByPlaceholder(/Buscar por nome ou código/i);
  await expect(search).toBeVisible();
  await search.fill("ASO");
  // ASO tem code "ASO" → normalizedCode "ASO" → testid suffix "ASO".
  await page.getByTestId("qualification-type-option-ASO").click();

  // Painel de roteamento humano (worker_documents).
  await expect(drawer).toContainText(/aba Documentos/i);
  await expect(drawer).toContainText(
    /cadastrado como documento do trabalhador/i,
  );
  await expect(drawer.getByTestId("drawer-manage-in-documents")).toBeVisible();

  // Save fica bloqueado (flowBlocked).
  await expect(drawer.getByTestId("save-qualification")).toBeDisabled();

  // Nenhum jargão técnico renderizado em lugar algum do drawer.
  const rawText = (await drawer.textContent()) ?? "";
  expect(
    rawText,
    `drawer expôs jargão técnico: ${rawText.match(TECHNICAL_JARGON)?.[0]}`,
  ).not.toMatch(TECHNICAL_JARGON);

  // Fecha o drawer.
  await page.keyboard.press("Escape");
});

// (B) Backend contract -------------------------------------------------------
test("RPC register_sst_revision com ASO retorna erro canônico, sem jargão", async ({
  authedPage: page,
}) => {
  test.setTimeout(60_000);

  // Precisa estar em uma rota do app para o cliente Supabase autenticado
  // estar montado no window.
  await page.goto(`${BASE_URL}/workers/${WORKER_ID}?tab=sst`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("add-qualification-button")).toBeVisible({
    timeout: 15_000,
  });

  const callRpc = async (documentTypeId: string) => {
    return await page.evaluate(
      async ({ workerId, dtId }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const supabase = w.supabase ?? w.__supabase ?? null;
        // Fallback: importar via módulo já resolvido pelo bundle.
        const client =
          supabase ??
          (await import("/src/integrations/supabase/client.ts").then(
            (m) => m.supabase,
          ));
        const { data, error } = await client.rpc("register_sst_revision", {
          payload: {
            worker_id: workerId,
            document_type_id: dtId,
            issued_at: new Date().toISOString().slice(0, 10),
            expires_at: null,
            file_path: null,
            file_name: null,
            file_hash: null,
            file_size: null,
            mode: "create",
          },
        });
        return {
          data,
          error: error
            ? { message: error.message, code: (error as any).code ?? null }
            : null,
        };
      },
      { workerId: WORKER_ID, dtId: documentTypeId },
    );
  };

  // ---- ASO -----------------------------------------------------------------
  const asoResult = await callRpc(ASO_TYPE_ID);

  // Precisa falhar (não pode ter gravado ASO em worker_sst_qualifications).
  expect(asoResult.error, "RPC deveria rejeitar ASO").not.toBeNull();

  const asoMsg = asoResult.error?.message ?? "";
  // A mensagem crua da RPC precisa ser um código canônico conhecido — nunca
  // um erro genérico do Postgres/PostgREST.
  expect(
    asoMsg,
    `mensagem crua da RPC para ASO deve ser um código conhecido, recebida: ${asoMsg}`,
  ).toMatch(
    /qualification_storage_flow_not_supported|document_type_not_sst_or_training|document_type_not_sst_nr/,
  );
  // E nunca deve conter jargão técnico bruto.
  expect(
    asoMsg,
    `mensagem crua da RPC para ASO vazou jargão: ${asoMsg.match(TECHNICAL_JARGON)?.[0]}`,
  ).not.toMatch(TECHNICAL_JARGON);

  // Nenhum registro foi criado.
  const asoInserted = Number(
    psql(
      `select count(*) from public.worker_sst_qualifications where worker_id='${WORKER_ID}' and document_type_id='${ASO_TYPE_ID}'`,
    ),
  );
  expect(asoInserted, "ASO não pode ter sido gravado em worker_sst_qualifications").toBe(0);

  // ---- Outro não-NR (se existir) -----------------------------------------
  test.skip(
    !OTHER_NON_NR_TYPE_ID,
    "catálogo sem tipo não-NR/ASO/training adicional — cenário genérico ignorado",
  );
  const otherResult = await callRpc(OTHER_NON_NR_TYPE_ID);
  expect(otherResult.error).not.toBeNull();
  const otherMsg = otherResult.error?.message ?? "";
  expect(otherMsg).toMatch(
    /qualification_storage_flow_not_supported|document_type_not_sst_or_training|document_type_not_sst_nr|unsupported_document_type/,
  );
  expect(otherMsg).not.toMatch(TECHNICAL_JARGON);
});