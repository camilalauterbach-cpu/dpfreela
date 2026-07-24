import { test, expect, type Page, type Response } from "./fixtures/auth";

// Q-022.A-HOTFIX-ASO — scenario B: a worker whose only context is
// historical (event completed) must be hidden by the active-only filter
// and must NOT generate a missing ASO in operational coverage.
//
// This spec is intentionally strict: it uses stable data-testid selectors
// emitted by src/pages/Qualifications.tsx and identifiers provided via
// environment variables so it is decoupled from display names/translations.

const HISTORICAL_WORKER_ID = process.env.E2E_HISTORICAL_ONLY_WORKER_ID;
const HISTORICAL_WORKER_NAME = process.env.E2E_HISTORICAL_ONLY_WORKER_NAME;
const HISTORICAL_EVENT_NAME = process.env.E2E_HISTORICAL_EVENT_NAME;
const ASO_DOCUMENT_TYPE_ID = process.env.E2E_ASO_DOCUMENT_TYPE_ID;

/**
 * Correlates the next list_worker_qualifications response to the exact
 * state we want to assert on (search term + operational filter). This
 * removes the race where toHaveCount(0) passes against a stale render
 * while the active-filter query is still in flight.
 */
function waitForQualificationsResponse(
  page: Page,
  options: { search: string; onlyActiveContexts: boolean },
): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    if (
      request.method() !== "POST" ||
      !response.url().includes("/rest/v1/rpc/list_worker_qualifications")
    ) {
      return false;
    }
    try {
      const payload = request.postDataJSON() as {
        p_search?: string | null;
        p_only_active_contexts?: boolean | null;
      };
      return (
        response.ok() &&
        payload.p_search === options.search &&
        payload.p_only_active_contexts === options.onlyActiveContexts
      );
    } catch {
      return false;
    }
  });
}

test(
  "B · trabalhador somente histórico fica fora do recorte ativo e aparece no painel geral",
  async ({ authedPage: page }) => {
    test.skip(
      !HISTORICAL_WORKER_ID ||
        !HISTORICAL_WORKER_NAME ||
        !HISTORICAL_EVENT_NAME ||
        !ASO_DOCUMENT_TYPE_ID,
      "Set E2E_HISTORICAL_ONLY_WORKER_ID / _NAME, E2E_HISTORICAL_EVENT_NAME and E2E_ASO_DOCUMENT_TYPE_ID to run this scenario.",
    );

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/qualifications");

    await expect(
      page.getByRole("heading", { name: /qualifica/i }),
    ).toBeVisible();

    const activeOnlyToggle = page.getByTestId("qualifications-active-only");
    const search = page.getByTestId("qualifications-search");
    const workerRow = page.getByTestId(
      `qualification-worker-${HISTORICAL_WORKER_ID}`,
    );

    // The active-only control is a mandatory part of the interface.
    await expect(activeOnlyToggle).toBeVisible();
    await expect(activeOnlyToggle).toBeChecked();

    // Gate 1 — with the active filter ON, a historical-only worker must NOT
    // appear. We wait for the RPC response whose payload matches the exact
    // search + p_only_active_contexts=true, so the absence is asserted
    // against a completed query, not against an intermediate render.
    const activeResponse = waitForQualificationsResponse(page, {
      search: HISTORICAL_WORKER_NAME!,
      onlyActiveContexts: true,
    });
    await search.fill(HISTORICAL_WORKER_NAME!);
    await expect(search).toHaveValue(HISTORICAL_WORKER_NAME!);
    await activeResponse;
    await expect(workerRow).toHaveCount(0);

    // Turn the operational filter off and wait for the corresponding
    // (search unchanged, p_only_active_contexts=false) response.
    const generalResponse = waitForQualificationsResponse(page, {
      search: HISTORICAL_WORKER_NAME!,
      onlyActiveContexts: false,
    });
    await activeOnlyToggle.click();
    await expect(activeOnlyToggle).not.toBeChecked();
    await generalResponse;

    // Gate 2 — the same search must now reveal the worker in the general view.
    await expect(workerRow).toBeVisible();
    await expect(workerRow).toContainText(HISTORICAL_WORKER_NAME!);
    await expect(workerRow).toContainText(HISTORICAL_EVENT_NAME!);
    await expect(workerRow).toHaveAttribute(
      "data-context-status",
      "historical",
    );

    // A historical context must not produce an operational ASO absence.
    const asoCell = page.getByTestId(
      `qualification-cell-${HISTORICAL_WORKER_ID}-${ASO_DOCUMENT_TYPE_ID}`,
    );

    await expect(asoCell).toBeVisible();
    await expect(asoCell).toHaveAttribute("data-required", "false");
    const documentStatus = await asoCell.getAttribute("data-document-status");
    expect(
      documentStatus,
      `data-document-status should not be "missing" for a historical context (got ${documentStatus})`,
    ).not.toBe("missing");

    expect(
      pageErrors,
      `pageerrors: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    const relevantConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("favicon") && !message.includes("ResizeObserver"),
    );
    expect(
      relevantConsoleErrors,
      `console errors: ${relevantConsoleErrors.join(" | ")}`,
    ).toEqual([]);
  },
);