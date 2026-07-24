import { test, expect } from "@playwright/test";
import { withInjectedAuth } from "./fixtures/auth";

/**
 * Q-024.A — Canonical catalog E2E.
 *
 * Validates that Settings → Roles consumes the canonical RPC
 * `list_worker_qualification_types` and never surfaces personal
 * documents (RG, CPF, CNH, título de eleitor, carteira profissional,
 * CREA, etc.), matching the ficha-do-trabalhador catalog exactly.
 *
 * Full scenarios (A/B/C in the Q-024.A spec) evolve in Q-024.D once the
 * SstCertificateDrawer also switches to the canonical hook — the
 * cargo × ficha equivalence is enforced today at the RPC layer.
 */

test.describe("Q-024.A — canonical worker qualification catalog", () => {
  test("Settings → Roles calls list_worker_qualification_types", async ({ page }) => {
    await withInjectedAuth(page);

    let rpcHits = 0;
    let rpcPayload: unknown = null;
    page.on("response", async (resp) => {
      const url = resp.url();
      if (url.includes("/rest/v1/rpc/list_worker_qualification_types")) {
        rpcHits += 1;
        try {
          rpcPayload = await resp.json();
        } catch {
          /* ignore body parse */
        }
      }
    });

    await page.goto("/settings");
    await page.getByRole("tab", { name: /cargos/i }).click();

    await expect
      .poll(() => rpcHits, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Personal document codes must never appear in the eligible catalog.
    const rows = Array.isArray(rpcPayload) ? (rpcPayload as Array<{ code: string; category: string }>) : [];
    const forbidden = ["CPF", "cpf", "rg_front", "rg_back", "CNH", "voter_id", "crea", "registro_prof", "carteira_prof"];
    for (const row of rows) {
      expect(forbidden).not.toContain(row.code);
      expect(["sst_nr", "sst_aso", "training"]).toContain(row.category);
    }
  });
});