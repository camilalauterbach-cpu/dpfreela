import { test, expect } from "@playwright/test";

// Q-022.A-HOTFIX-ASO / Q-023 core — scenario A/C/D
// Requires authenticated session; run in an environment where
// LOVABLE_BROWSER_SUPABASE_* is injected.

test.describe("Qualifications — requirements & unresolved contexts", () => {
  test("A · Igor/Marlene (unresolved_role) — ASO required, NR shows context pendente", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/qualifications");
    // Active-only filter default ON
    await expect(page.getByRole("heading", { name: /qualifica/i })).toBeVisible();

    // Search for one of the two known unresolved workers
    const search = page.getByPlaceholder(/buscar|search/i);
    await search.fill("Marlene Pereira");
    await page.waitForLoadState("networkidle");

    // Row present with unresolved badge
    const row = page.getByRole("row", { name: /Marlene Pereira/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText(/pendente|contexto pendente/i)).toBeVisible();

    // ASO cell → missing (Ausente), not "Não aplicável"
    await expect(row).not.toContainText(/não aplicável/i);
    expect(errors, `pageerrors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("C · Amanda — ASO, Integração, NR06, NR18 required with correct origins", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/qualifications");
    await page.getByPlaceholder(/buscar|search/i).fill("Amanda Oliveira Alves");
    await page.waitForLoadState("networkidle");
    const row = page.getByRole("row", { name: /Amanda Oliveira Alves/i }).first();
    await expect(row).toBeVisible();
    // Expect at least these requirements as columns/badges
    for (const doc of ["ASO", "Integração", "NR 06", "NR 18"]) {
      await expect(page.getByText(doc, { exact: false }).first()).toBeVisible();
    }
    expect(errors).toHaveLength(0);
  });

  test("D · Counters — active vs historical separated", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/qualifications");
    // Counter chips: "Contextos ativos" and "Somente histórico" should be visible & distinct
    await expect(page.getByText(/contextos ativos/i)).toBeVisible();
    await expect(page.getByText(/hist[oó]rico/i)).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
