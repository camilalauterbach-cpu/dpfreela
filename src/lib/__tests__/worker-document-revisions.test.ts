import { describe, expect, it, vi } from "vitest";
import {
  buildWorkerDocumentRevisionPayload,
  registerWorkerDocumentRevision,
} from "../worker-document-revisions";

describe("worker document revision RPC contract", () => {
  it("builds canonical p_payload for the first revision", () => {
    const payload = buildWorkerDocumentRevisionPayload({
      workerId: "11111111-1111-4111-8111-111111111111",
      documentTypeId: "22222222-2222-4222-8222-222222222222",
      filePath: "w/cpf/file.pdf",
      fileName: "file.pdf",
      fileSize: 123,
      mimeType: "application/pdf",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    expect(payload).toMatchObject({
      worker_id: "11111111-1111-4111-8111-111111111111",
      document_type_id: "22222222-2222-4222-8222-222222222222",
      operation: "initial",
      expected_current_document_id: null,
      idempotency_key: "33333333-3333-4333-8333-333333333333",
      file_path: "w/cpf/file.pdf",
      status: "uploaded",
    });
  });

  it("turns a new upload over an existing current document into renewal with stale guard", () => {
    const payload = buildWorkerDocumentRevisionPayload({
      workerId: "11111111-1111-4111-8111-111111111111",
      documentTypeId: "22222222-2222-4222-8222-222222222222",
      currentDocumentId: "44444444-4444-4444-8444-444444444444",
      filePath: "w/rg/new.pdf",
      fileName: "new.pdf",
      fileSize: 456,
      mimeType: "application/pdf",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    expect(payload.operation).toBe("renewal");
    expect(payload.expected_current_document_id).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("calls only register_worker_document_revision(jsonb) via p_payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { idempotent_hit: false }, error: null });

    await registerWorkerDocumentRevision({ rpc }, {
      workerId: "11111111-1111-4111-8111-111111111111",
      documentTypeId: "22222222-2222-4222-8222-222222222222",
      filePath: "w/photo/photo.jpg",
      fileName: "photo.jpg",
      fileSize: 789,
      mimeType: "image/jpeg",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    expect(rpc).toHaveBeenCalledWith("register_worker_document_revision", {
      p_payload: expect.objectContaining({
        worker_id: "11111111-1111-4111-8111-111111111111",
        document_type_id: "22222222-2222-4222-8222-222222222222",
      }),
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_worker_id");
  });
});
