import { test, expect } from "./fixtures/auth";

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

    // Search by a real person, not by the word "historical".
    await search.fill(HISTORICAL_WORKER_NAME!);
    await expect(search).toHaveValue(HISTORICAL_WORKER_NAME!);

    // Gate 1 — with the active filter ON, a historical-only worker must NOT appear.
    await expect(workerRow).toHaveCount(0);

    // Turn the operational filter off.
    await activeOnlyToggle.click();
    await expect(activeOnlyToggle).not.toBeChecked();

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