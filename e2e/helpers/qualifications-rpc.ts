import { expect, type Page, type Response } from "../fixtures/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Correlated waiter for the `list_worker_qualifications` RPC.
 *
 * Register the promise BEFORE the interaction that triggers the query.
 * Reuse the resolved response and its parsed payload for every assertion
 * tied to that single filter change — do not create a new waiter per
 * `expect` call, because React Query may serve subsequent renders from
 * cache and no new network request will fire.
 */

interface QualificationsRpcRequest {
  p_search?: string | null;
  p_only_active_contexts?: boolean;
  p_document_type_ids?: string[] | null;
  p_event_id?: string | null;
  p_link_group_id?: string | null;
  p_job_role_id?: string | null;
}

export interface QualificationsRpcPayload {
  schema_version: number;
  total?: number;
  total_workers?: number;
  items: Array<{
    worker_id: string;
    worker_name: string;
    context_status?: string;
    cells?: Array<{
      document_type_id: string;
      required?: boolean;
      status?: string;
    }>;
  }>;
}

export interface QualificationsExpectation {
  search: string | null;
  onlyActiveContexts: boolean;
}

function isQualificationsRpc(response: Response): boolean {
  const request = response.request();
  const pathname = new URL(response.url()).pathname;
  return (
    request.method() === "POST" &&
    pathname.endsWith("/rest/v1/rpc/list_worker_qualifications")
  );
}

export function waitForQualificationsRpc(
  page: Page,
  expected: QualificationsExpectation,
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      if (!isQualificationsRpc(response)) return false;
      let body: QualificationsRpcRequest;
      try {
        body = response.request().postDataJSON() as QualificationsRpcRequest;
      } catch {
        return false;
      }
      return (
        (body.p_search ?? null) === expected.search &&
        body.p_only_active_contexts === expected.onlyActiveContexts
      );
    },
    { timeout: 20_000 },
  );
}

export async function readQualificationsResponse(
  response: Response,
): Promise<QualificationsRpcPayload> {
  const rawBody = await response.text();
  expect(
    response.ok(),
    [
      "A RPC list_worker_qualifications retornou erro.",
      `Status: ${response.status()}`,
      `Resposta: ${rawBody}`,
    ].join("\n"),
  ).toBeTruthy();
  try {
    return JSON.parse(rawBody) as QualificationsRpcPayload;
  } catch {
    throw new Error(
      `A RPC list_worker_qualifications não retornou JSON válido: ${rawBody}`,
    );
  }
}