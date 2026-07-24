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

  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c: any) => ({ ...c, url: BASE_URL }));
    await page.context().addCookies(cookies);
  }
  await page.goto(BASE_URL);
  if (storageKey && sessionJson) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [storageKey, sessionJson] as const,
    );
  }
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