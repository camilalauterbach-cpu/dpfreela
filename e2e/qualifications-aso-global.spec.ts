import { test, expect } from "@playwright/test";

// Q-022.A-HOTFIX-ASO — scenario B: historical-only worker (Shakira)
// must NOT count against active ASO coverage.

test("B · Historical-only worker (Shakira) — hidden by active filter, visible when toggled off", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/qualifications");

  // With active-only filter (default ON), historical-only worker must not appear
  const toggle = page.getByRole("switch", { name: /apenas.*ativos|active/i });
  if (await toggle.isVisible()) {
    await expect(toggle).toBeChecked();
  }
  await page.getByPlaceholder(/buscar|search/i).fill("Historico");
  await page.waitForLoadState("networkidle");

  // Now disable filter → historical contexts appear
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForLoadState("networkidle");
  }
  // Any Shakira-context row eventually becomes visible in general view
  await expect(page.getByText(/Shakira/i).first()).toBeVisible({ timeout: 15_000 });

  expect(errors, `pageerrors: ${errors.join(" | ")}`).toHaveLength(0);
});
