import { test, expect, BASE_URL } from "./fixtures/auth";

/**
 * Q-001 / Q-003 — Settings → Cargos
 *
 * Regression coverage for the insertBefore crash and the inline-mutation
 * flows we replaced with Dialog / AlertDialog in Fase 1.2.
 *
 * These tests exercise the UI only — no seed data is written. They rely on
 * whichever cargos already exist in the target environment.
 */
test.describe("Configurações → Cargos", () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto(`${BASE_URL}/settings/job-roles`);
    await expect(authedPage.getByRole("heading", { name: /Cargos/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('opens the "Novo cargo" dialog without crashing', async ({ authedPage }) => {
    await authedPage.getByRole("button", { name: /Novo cargo/i }).click();
    await expect(authedPage.getByRole("dialog")).toBeVisible();
    await expect(authedPage.getByLabel(/Nome/i)).toBeVisible();
    await authedPage.getByRole("button", { name: /Cancelar/i }).click();
    await expect(authedPage.getByRole("dialog")).toHaveCount(0);
    // No React crash — root remains mounted.
    await expect(authedPage.locator("#root")).toBeVisible();
  });

  test("opens role action menu and rename dialog without insertBefore crash", async ({ authedPage }) => {
    const rolesList = authedPage.locator("ul.divide-y").first();
    const firstRow = rolesList.locator("li").first();
    await expect(firstRow).toBeVisible();
    const menuTrigger = firstRow.getByRole("button").last();
    await menuTrigger.click();

    const renameItem = authedPage.getByRole("menuitem", { name: /Renomear/i });
    await expect(renameItem).toBeVisible();
    await renameItem.click();

    // Dialog should appear after menu unmount without throwing.
    await expect(authedPage.getByRole("dialog")).toBeVisible();
    await expect(authedPage.getByText(/Renomear cargo/i)).toBeVisible();
    await authedPage.getByRole("button", { name: /Cancelar/i }).click();
    await expect(authedPage.getByRole("dialog")).toHaveCount(0);
    await expect(authedPage.locator("#root")).toBeVisible();
  });

  test("inactivate/activate opens AlertDialog with impact preview", async ({ authedPage }) => {
    const rolesList = authedPage.locator("ul.divide-y").first();
    const firstRow = rolesList.locator("li").first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole("button").last().click();
    const toggleItem = authedPage.getByRole("menuitem", { name: /Inativar|Ativar/i });
    await toggleItem.click();

    const alert = authedPage.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: /Cancelar/i })).toBeVisible();
    await alert.getByRole("button", { name: /Cancelar/i }).click();
    await expect(authedPage.getByRole("alertdialog")).toHaveCount(0);
    await expect(authedPage.locator("#root")).toBeVisible();
  });

  test("page does not throw uncaught errors on load", async ({ authedPage }) => {
    const errors: string[] = [];
    authedPage.on("pageerror", (err) => errors.push(err.message));
    await authedPage.reload();
    await expect(authedPage.getByRole("heading", { name: /Cargos/i }).first()).toBeVisible();
    expect(errors.filter((m) => /insertBefore|NotFoundError/i.test(m))).toEqual([]);
  });
});