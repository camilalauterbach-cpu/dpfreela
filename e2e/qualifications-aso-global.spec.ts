import { test, expect, type Page, type Response } from "./fixtures/auth";
import {
  waitForQualificationsRpc,
  readQualificationsResponse,
} from "./helpers/qualifications-rpc";

// Q-022.A-HOTFIX-ASO — scenario B: a worker whose only context is
// historical (event completed) must be hidden by the active-only filter
// and must NOT generate a missing ASO in operational coverage.
//
// This spec is intentionally strict: it uses stable data-testid selectors
// emitted by src/pages/Qualifications.tsx, correlates each filter change
// with the exact list_worker_qualifications response before asserting,
// and validates the API payload before the UI so we never mistake an
// in-flight query for an "empty" result.

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

    // Gate 1 — with the active filter ON, a historical-only worker must NOT
    // appear. Register the waiter BEFORE filling the search so the
    // response is guaranteed to correspond to this exact filter state.
    // A single response backs every assertion in this gate — do not
    // register a new waiter per assert (React Query may serve the next
    // renders from cache with no network round trip).
    const activeRpc = waitForQualificationsRpc(page, {
      search: HISTORICAL_WORKER_NAME!,
      onlyActiveContexts: true,
    });
    await search.fill(HISTORICAL_WORKER_NAME!);
    await expect(search).toHaveValue(HISTORICAL_WORKER_NAME!);

    const activeResponse = await activeRpc;
    const activePayload = await readQualificationsResponse(activeResponse);

    expect(activePayload.schema_version).toBeGreaterThanOrEqual(2);
    // API truth first: the historical-only worker is not part of the
    // active operational slice.
    expect(
      activePayload.items.find(
        (item) => item.worker_id === HISTORICAL_WORKER_ID,
      ),
      "worker with only historical contexts must not appear in active slice",
    ).toBeUndefined();

    // UI truth: the final rendered state must reflect the empty result.
    // `toHaveCount(0)` alone is insufficient (could be a stale render),
    // but combined with the API assertion above it is now conclusive.
    await expect(workerRow).toHaveCount(0);
    await expect(
      page.getByText("Nenhum trabalhador encontrado com os filtros atuais."),
    ).toBeVisible();

    // Gate 2 — turn the operational filter off. Register the waiter for
    // the (same search, p_only_active_contexts=false) call BEFORE the
    // click so we cannot miss the response.
    const generalRpc = waitForQualificationsRpc(page, {
      search: HISTORICAL_WORKER_NAME!,
      onlyActiveContexts: false,
    });
    await activeOnlyToggle.click();
    await expect(activeOnlyToggle).not.toBeChecked();

    const generalResponse = await generalRpc;
    const generalPayload = await readQualificationsResponse(generalResponse);

    const historicalItem = generalPayload.items.find(
      (item) => item.worker_id === HISTORICAL_WORKER_ID,
    );
    expect(
      historicalItem,
      "worker must appear in the general (historical-inclusive) view",
    ).toBeDefined();

    // The general view must reveal the worker with historical context
    // metadata.
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