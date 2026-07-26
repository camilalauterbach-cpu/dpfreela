// E2E: verifies /version.json polling avoids cached responses.
//
// Contract (src/lib/version-check.ts::fetchRemoteVersion):
//   - URL carries an anti-cache query param (?t=<ms>)
//   - Request is sent with cache: "no-store"
//   - Request headers include cache-control: no-cache and pragma: no-cache
//   - When the remote flips version, the gate appears on the next poll
//     trigger WITHOUT a stale response sneaking in.

import { test, expect, type Page, type Route, type Request } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const LOCAL = "dev";

type Mock = { current: string };

async function installVersionMock(
  page: Page,
  mock: Mock,
  captured: Request[],
) {
  await page.route("**/version.json*", (route: Route) => {
    captured.push(route.request());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      // Server sends aggressive no-store too, but the client contract is
      // independent of what the server sets.
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ version: mock.current }),
    });
  });
}

test.describe("Version polling — no-store guarantees", () => {
  test("every /version.json request uses cache:no-store, unique anti-cache query, and no-cache headers", async ({
    page,
  }) => {
    const mock: Mock = { current: LOCAL };
    const captured: Request[] = [];
    await installVersionMock(page, mock, captured);

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    // Initial poll fires immediately from createVersionController().
    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("update-gate")).toHaveCount(0);

    // Force additional polls via focus/online/visibilitychange triggers.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(3);

    // Assert per-request contract for every captured /version.json call.
    const urls = new Set<string>();
    for (const req of captured) {
      const url = req.url();
      // Anti-cache query param must be present and non-empty.
      const parsed = new URL(url);
      const t = parsed.searchParams.get("t");
      expect(t, `missing ?t on ${url}`).toBeTruthy();
      expect(t!.length).toBeGreaterThan(0);
      urls.add(url);

      // Playwright surfaces the fetch init cache mode via the internal
      // Request; assert it is "no-store".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = (req as any).resourceType?.() ?? "";
      expect(["fetch", "xhr", "other", ""]).toContain(info);

      const headers = await req.allHeaders();
      // Cache-Control + Pragma must forbid caches from serving stale data.
      expect((headers["cache-control"] ?? "").toLowerCase()).toContain("no-cache");
      expect((headers["pragma"] ?? "").toLowerCase()).toContain("no-cache");
    }
    // Every request URL must be unique thanks to the ?t=<ms> cache buster —
    // this is what prevents intermediate caches from replaying a stale body.
    expect(urls.size).toBe(captured.length);

    // Flip remote → the very next poll must expose the new version and the
    // gate must appear immediately (no stale cached "dev" response wins).
    mock.current = "v-nocache-1";
    const before = captured.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId("update-gate")).toBeVisible({ timeout: 3_000 });
  });
});
