// E2E: enforced version update flow.
//
// Verifies the runtime contract implemented in src/lib/version-check.ts +
// src/components/UpdateGate.tsx:
//   1. Same version → no gate.
//   2. Different version → blocking gate appears.
//   3. Manual click reloads exactly once for that target version.
//   4. On the reloaded page the auto attempt is blocked by the guard
//      (already-attempted), the button leaves "Atualizando…" and an error
//      is shown; a manual click retries with manualRetry=true and reloads
//      exactly one more time.
//   5. When the remote confirms it matches local, the guard is cleared,
//      so a subsequent new target reloads once again.
//   6. Cross-tab: a stale detection in tab A blocks tab B via
//      BroadcastChannel (with storage-event fallback in the same context).
//
// No auth is needed — UpdateGate is mounted at the app root and
// operates before route-level guards.

import { test, expect, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
// LOCAL_VERSION is "dev" in dev mode (see vite.config.ts define).
const LOCAL = "dev";

type Mock = { current: string };

async function installVersionMock(page: Page, mock: Mock) {
  await page.route("**/version.json*", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ version: mock.current }),
    });
  });
}

// Robust per-tab load counter: an init script runs on every navigation and
// increments a sessionStorage counter (survives reloads within the same
// origin/tab). Reading it via page.evaluate is deterministic.
async function installLoadCounter(page: Page) {
  await page.addInitScript(() => {
    try {
      const k = "__e2e_load_count__";
      const n = Number(sessionStorage.getItem(k) ?? "0") + 1;
      sessionStorage.setItem(k, String(n));
    } catch {
      /* noop */
    }
  });
  return {
    read: async () =>
      Number(
        await page.evaluate(() => sessionStorage.getItem("__e2e_load_count__") ?? "0"),
      ),
  };
}

test.describe("Version update gate", () => {
  test("same version → no gate; different version → gate blocks and reloads once per target", async ({
    page,
  }) => {
    const mock: Mock = { current: LOCAL };
    const loads = await installLoadCounter(page);
    await installVersionMock(page, mock);

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    // Give the initial /version.json check time to settle.
    await page.waitForTimeout(500);
    await expect(page.getByTestId("update-gate")).toHaveCount(0);
    const loadsAfterInitial = await loads.read();
    expect(loadsAfterInitial).toBe(1);

    // Flip the mock to a new remote version and force an immediate re-check
    // by dispatching a real `online` event (contractual poll trigger).
    mock.current = "v-remote-1";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const gate = page.getByTestId("update-gate");
    await expect(gate).toBeVisible();

    // ESC must NOT dismiss the gate.
    await page.keyboard.press("Escape");
    await expect(gate).toBeVisible();

    // Click "Atualizar agora" → single reload for target v-remote-1.
    await Promise.all([
      page.waitForEvent("load"),
      page.getByTestId("update-gate-action").click(),
    ]);
    expect(await loads.read()).toBe(2);

    // After reload, the bundle is still "dev" (dev mode) but the mock still
    // reports v-remote-1 → gate re-appears. The auto attempt (15s timer)
    // must be blocked by the target-scoped guard → "Atualizando…" clears
    // and an error is shown. No further reload happens without a click.
    await expect(page.getByTestId("update-gate")).toBeVisible();
    // Wait past the auto-update timer (15s).
    await page.waitForTimeout(16_000);
    await expect(page.getByTestId("update-gate-error")).toBeVisible();
    await expect(page.getByTestId("update-gate-action")).toHaveText(/Atualizar agora/);
    expect(await loads.read()).toBe(2); // no auto reload

    // Manual retry click → exactly one additional reload.
    await Promise.all([
      page.waitForEvent("load"),
      page.getByTestId("update-gate-action").click(),
    ]);
    expect(await loads.read()).toBe(3);

    // Now confirm remote === local: guard must be cleared so a NEW target
    // reloads once again.
    mock.current = LOCAL;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("update-gate")).toHaveCount(0);

    mock.current = "v-remote-2";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("update-gate")).toBeVisible();
    await Promise.all([
      page.waitForEvent("load"),
      page.getByTestId("update-gate-action").click(),
    ]);
    expect(await loads.read()).toBe(4);
  });

  test("cross-tab: stale detected in tab A blocks tab B", async ({ browser }) => {
    const context = await browser.newContext();
    const mock: Mock = { current: LOCAL };

    const pageA = await context.newPage();
    await installVersionMock(pageA, mock);
    await pageA.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await pageA.waitForTimeout(300);
    await expect(pageA.getByTestId("update-gate")).toHaveCount(0);

    const pageB = await context.newPage();
    await installVersionMock(pageB, mock);
    await pageB.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await pageB.waitForTimeout(300);
    await expect(pageB.getByTestId("update-gate")).toHaveCount(0);

    // Tab A observes a new version and broadcasts.
    mock.current = "v-cross-1";
    await pageA.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(pageA.getByTestId("update-gate")).toBeVisible();

    // Tab B did not fetch — it must still block because it received the
    // BroadcastChannel/storage message from tab A (same browser context).
    await expect(pageB.getByTestId("update-gate")).toBeVisible({ timeout: 5_000 });

    await context.close();
  });
});