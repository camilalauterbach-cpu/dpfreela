/**
 * Regressão de escopo da CTE `totals` em
 * public.list_worker_qualifications (10 args, schema_version=2).
 *
 * Bug histórico: a CTE `totals` era definida em um WITH e usada num
 * segundo `SELECT ... INTO v_totals FROM totals` — PostgreSQL retornava
 * `42P01 relation "totals" does not exist` e a página /qualifications
 * ficava totalmente indisponível.
 *
 * Este teste chama a RPC via HTTP autenticado com quatro combinações
 * críticas e falha se:
 *   - a resposta não for 200,
 *   - o corpo não trouxer schema_version=2, ou
 *   - a mensagem de erro contiver "totals does not exist".
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect, request as pwRequest } from "@playwright/test";

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;

test.describe("list_worker_qualifications — regressão CTE totals", () => {
  test.skip(
    !SUPABASE_URL || !ANON || !ACCESS_TOKEN,
    "Requer LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN + VITE_SUPABASE_URL/anon key.",
  );

  const cases = [
    { name: "active=true, todas as colunas", body: { p_only_active_contexts: true, p_only_relevant: true } },
    { name: "active=false, todas as colunas", body: { p_only_active_contexts: false, p_only_relevant: false } },
    { name: "state=missing", body: { p_state: "missing", p_only_active_contexts: false, p_only_relevant: false } },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const ctx = await pwRequest.newContext();
      const payload = {
        p_document_type_ids: null,
        p_search: null,
        p_state: null,
        p_only_relevant: false,
        p_limit: 200,
        p_offset: 0,
        p_only_active_contexts: false,
        p_event_id: null,
        p_link_group_id: null,
        p_job_role_id: null,
        ...c.body,
      };
      const res = await ctx.post(`${SUPABASE_URL}/rest/v1/rpc/list_worker_qualifications`, {
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: payload,
      });
      const text = await res.text();
      expect(text, `RPC não pode mais mencionar "totals does not exist": ${text}`).not.toMatch(/totals.*does not exist/i);
      expect(res.status(), `status esperado 200, resposta: ${text}`).toBe(200);
      const json = JSON.parse(text);
      expect(json.schema_version).toBe(2);
      expect(json).toHaveProperty("totals.total_workers");
      expect(Array.isArray(json.items)).toBe(true);
      await ctx.dispose();
    });
  }
});
