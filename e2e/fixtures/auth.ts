import { test as base, expect, type Page, type Response } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Authenticated fixture for DPfreela E2E.
 *
 * Uses the Lovable browser sandbox session vars injected at runtime
 * (LOVABLE_BROWSER_SUPABASE_STORAGE_KEY / _SESSION_JSON / _COOKIES_JSON).
 * Falls back to a no-op when running outside the sandbox — the test suite
 * will skip auth-required specs in that case.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

export async function restoreSupabaseSession(page: Page) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;

  // Install the Supabase session BEFORE the first navigation so the JS
  // client boots already authenticated on the very first render. Using
  // addInitScript avoids the "first page loads as anonymous, then we
  // stuff localStorage" race that forced a reload previously.
  if (storageKey && sessionJson) {
    await page.addInitScript(
      ({ key, value }) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* storage may be unavailable on about:blank */
        }
      },
      { key: storageKey, value: sessionJson },
    );
  }

  if (cookiesJson) {
    const baseOrigin = new URL(BASE_URL).origin;
    const parsed = JSON.parse(cookiesJson) as Array<Record<string, any>>;
    const cookies = parsed.map((cookie) => {
      if (cookie.domain) return cookie;
      return { ...cookie, url: cookie.url ?? baseOrigin };
    });
    await page.context().addCookies(cookies as any);
  }

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const status = process.env.LOVABLE_BROWSER_AUTH_STATUS;
    if (status !== "injected") {
      test.skip(true, `No injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${status}).`);
    }
    await restoreSupabaseSession(page);
    await use(page);
  },
});

export { expect, BASE_URL };
export type { Page, Response };