// E2E: verifies that when a version update is enforced, performUpdate() in
// src/lib/version-check.ts correctly coordinates the service worker lifecycle:
//
//   1. Calls navigator.serviceWorker.getRegistration()
//   2. Awaits registration.update()
//   3. When a waiting worker exists, posts { type: "SKIP_WAITING" } to it
//   4. Waits for a controllerchange event before triggering location.reload()
//
// Dev builds do NOT register a real service worker, so we install a scripted
// mock of navigator.serviceWorker via addInitScript before app boot. The mock
// records every interaction into sessionStorage so it survives the reload
// triggered by performUpdate(), and we assert on the recorded trace afterward.

import { test, expect, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
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

// Scripted service-worker mock. Records events into sessionStorage under
// __e2e_sw_trace__ so they survive location.reload(). The waiting worker's
// postMessage handler emits a `controllerchange` on navigator.serviceWorker
// after a microtask, exactly as a real SW would after SKIP_WAITING activates.
async function installServiceWorkerMock(page: Page) {
  await page.addInitScript(() => {
    const KEY = "__e2e_sw_trace__";
    const push = (entry: Record<string, unknown>) => {
      try {
        const raw = sessionStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push({ ...entry, t: Date.now() });
        sessionStorage.setItem(KEY, JSON.stringify(arr));
      } catch {
        /* noop */
      }
    };

    const listeners: Record<string, Array<(e: Event) => void>> = {};
    const waiting = {
      postMessage(msg: unknown) {
        push({ kind: "waiting.postMessage", msg });
        // Simulate real SW: after SKIP_WAITING, the new worker activates and
        // takes control, which fires `controllerchange` on the container.
        queueMicrotask(() => {
          push({ kind: "controllerchange.fired" });
          (listeners["controllerchange"] ?? []).forEach((fn) => {
            try {
              fn(new Event("controllerchange"));
            } catch {
              /* noop */
            }
          });
        });
      },
    };

    const registration = {
      waiting,
      async update() {
        push({ kind: "registration.update" });
        return undefined;
      },
    };

    const swContainer = {
      async getRegistration() {
        push({ kind: "getRegistration" });
        return registration;
      },
      addEventListener(type: string, fn: (e: Event) => void, opts?: unknown) {
        void opts;
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener(type: string, fn: (e: Event) => void) {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
      },
      controller: null,
    };

    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        get: () => swContainer,
      });
    } catch {
      /* noop */
    }

    // Count real page loads so we can prove performUpdate actually reloaded
    // after the controllerchange resolved (window.location.reload is
    // non-configurable in Chromium, so we cannot stub it).
    try {
      const K = "__e2e_load_count__";
      const n = Number(sessionStorage.getItem(K) ?? "0") + 1;
      sessionStorage.setItem(K, String(n));
      push({ kind: "load", n });
    } catch {
      /* noop */
    }
  });
}

async function readTrace(page: Page): Promise<Array<{ kind: string; msg?: { type?: string } }>> {
  return await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem("__e2e_sw_trace__") ?? "[]");
    } catch {
      return [];
    }
  });
}

test.describe("Version update gate — PWA service worker coordination", () => {
  test("performUpdate calls registration.update(), posts SKIP_WAITING, awaits controllerchange, then reloads", async ({
    page,
  }) => {
    const mock: Mock = { current: LOCAL };
    await installServiceWorkerMock(page);
    await installVersionMock(page, mock);

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    await expect(page.getByTestId("update-gate")).toHaveCount(0);

    // Flip remote -> gate becomes visible.
    mock.current = "v-pwa-1";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("update-gate")).toBeVisible();

    // Click "Atualizar agora" -> performUpdate() runs and then triggers a
    // real reload. Wait for the load event to confirm the reload happened.
    await Promise.all([
      page.waitForEvent("load"),
      page.getByTestId("update-gate-action").click(),
    ]);

    // sessionStorage survives the reload in the same tab, so the SW trace
    // recorded during performUpdate is still readable here.
    const trace = await readTrace(page);
    const kinds = trace.map((e) => e.kind);

    // Two page loads must have been observed: initial + one triggered by
    // performUpdate (proving location.reload actually executed after the
    // controllerchange resolved).
    const loadCount = await page.evaluate(() =>
      Number(sessionStorage.getItem("__e2e_load_count__") ?? "0"),
    );
    expect(loadCount).toBe(2);

    // Ordering contract during the update, all BEFORE the second load:
    //   getRegistration -> registration.update ->
    //   waiting.postMessage(SKIP_WAITING) -> controllerchange.fired ->
    //   (then) second `load`.
    const iGet = kinds.indexOf("getRegistration");
    const iUpdate = kinds.indexOf("registration.update");
    const iPost = kinds.indexOf("waiting.postMessage");
    const iCtrl = kinds.indexOf("controllerchange.fired");
    // Index of the SECOND load marker (the first is the initial navigation).
    const loadIdxs = kinds
      .map((k, i) => (k === "load" ? i : -1))
      .filter((i) => i >= 0);
    const iSecondLoad = loadIdxs[1] ?? -1;

    expect(iGet).toBeGreaterThanOrEqual(0);
    expect(iUpdate).toBeGreaterThan(iGet);
    expect(iPost).toBeGreaterThan(iUpdate);
    expect(iCtrl).toBeGreaterThan(iPost);
    expect(iSecondLoad).toBeGreaterThan(iCtrl);

    // The message posted to the waiting worker must be SKIP_WAITING.
    const postEntry = trace.find((e) => e.kind === "waiting.postMessage");
    expect(postEntry?.msg?.type).toBe("SKIP_WAITING");
  });
});
