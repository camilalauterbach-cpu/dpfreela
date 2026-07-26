import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAttempt,
  getOrCreateAttempt,
  loadAttempt,
  performIdempotentWorkerDocumentUpload,
  IdempotentUploadStageError,
} from "@/lib/worker-document-upload-attempt";

// Minimal File shim reused across tests. Same fingerprint → same attempt key.
function makeFile(name = "aso.pdf", size = 1234, type = "application/pdf", lastModified = 1_700_000_000_000) {
  return {
    name,
    size,
    type,
    lastModified,
    // deliberately not a real Blob — the helper never inspects contents,
    // only forwards to the mocked storage client.
  } as unknown as File;
}

function makeClient(overrides?: {
  rpc?: (name: string, args: any) => Promise<{ data: unknown; error: unknown }>;
  upload?: (path: string, file: any, opts?: any) => Promise<{ error: unknown }>;
  remove?: (paths: string[]) => Promise<{ error: unknown }>;
}) {
  const rpc = overrides?.rpc ?? vi.fn(async () => ({ data: { document: { id: "doc-1" }, trace_id: "t1" }, error: null }));
  const upload = overrides?.upload ?? vi.fn(async () => ({ error: null }));
  const remove = overrides?.remove ?? vi.fn(async () => ({ error: null }));
  return {
    rpc,
    storage: {
      from: () => ({ upload, remove }),
    },
    _spies: { rpc, upload, remove },
  };
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("getOrCreateAttempt", () => {
  it("creates a stable attempt for the same file and reuses it on replay", () => {
    const file = makeFile();
    const first = getOrCreateAttempt("w1", "dt1", file, () => "path/one");
    expect(first.replay).toBe(false);
    expect(first.attempt.attempts).toBe(1);

    const second = getOrCreateAttempt("w1", "dt1", file, () => "path/should-not-be-used");
    expect(second.replay).toBe(true);
    expect(second.attempt.idempotencyKey).toBe(first.attempt.idempotencyKey);
    expect(second.attempt.storagePath).toBe(first.attempt.storagePath);
    expect(second.attempt.attempts).toBe(2);
  });

  it("scopes attempts by (worker, documentType, file fingerprint)", () => {
    const a = getOrCreateAttempt("w1", "dt1", makeFile("a.pdf"), () => "p/a");
    const b = getOrCreateAttempt("w1", "dt1", makeFile("b.pdf"), () => "p/b");
    const c = getOrCreateAttempt("w2", "dt1", makeFile("a.pdf"), () => "p/c");
    const d = getOrCreateAttempt("w1", "dt2", makeFile("a.pdf"), () => "p/d");
    const keys = new Set([a, b, c, d].map((x) => x.attempt.idempotencyKey));
    expect(keys.size).toBe(4);
  });
});

describe("performIdempotentWorkerDocumentUpload", () => {
  it("uploads, calls the RPC with the attempt idempotency key and clears the attempt on success", async () => {
    const file = makeFile();
    const { attempt } = getOrCreateAttempt("w1", "dt1", file, () => "w1/dt1/first.pdf");
    const client = makeClient();

    const out = await performIdempotentWorkerDocumentUpload(client as any, {
      workerId: "w1",
      documentTypeId: "dt1",
      file,
      storagePath: attempt.storagePath,
      contentType: "application/pdf",
    });

    expect(client._spies.upload).toHaveBeenCalledTimes(1);
    expect(client._spies.upload.mock.calls[0][0]).toBe("w1/dt1/first.pdf");
    expect(client._spies.upload.mock.calls[0][2]).toMatchObject({ upsert: true });
    // rpc called with the same idempotency key stored in the attempt
    const rpcArgs = (client._spies.rpc.mock.calls.find((c: any[]) => c[0] === "register_worker_document_revision") ?? [])[1];
    expect(rpcArgs?.p_payload?.idempotency_key).toBe(attempt.idempotencyKey);
    expect(out.result.document).toBeDefined();
    expect(loadAttempt("w1", "dt1", file)).toBeNull();
  });

  it("reuses the same storage path and idempotency key on retry after a transient DB failure", async () => {
    const file = makeFile();
    const { attempt } = getOrCreateAttempt("w1", "dt1", file, () => "w1/dt1/only.pdf");

    // First attempt: DB fails with a transient message (network / 5xx).
    const firstClient = makeClient({
      rpc: vi.fn(async (name: string) => {
        if (name === "register_worker_document_revision") {
          return { data: null, error: { message: "network error" } };
        }
        return { data: null, error: null };
      }),
    });

    await expect(
      performIdempotentWorkerDocumentUpload(firstClient as any, {
        workerId: "w1",
        documentTypeId: "dt1",
        file,
        storagePath: attempt.storagePath,
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(IdempotentUploadStageError);

    // Attempt survives — storage NOT wiped, so retry is idempotent.
    expect(firstClient._spies.remove).not.toHaveBeenCalled();
    const persisted = loadAttempt("w1", "dt1", file);
    expect(persisted).not.toBeNull();
    expect(persisted!.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(persisted!.storagePath).toBe(attempt.storagePath);

    // Retry: the RPC now returns idempotent_hit. Same key, same path.
    const retryClient = makeClient({
      rpc: vi.fn(async () => ({ data: { idempotent_hit: true }, error: null })),
    });
    const out = await performIdempotentWorkerDocumentUpload(retryClient as any, {
      workerId: "w1",
      documentTypeId: "dt1",
      file,
      storagePath: attempt.storagePath,
      contentType: "application/pdf",
    });
    expect(retryClient._spies.upload.mock.calls[0][0]).toBe(attempt.storagePath);
    const retryRpc = retryClient._spies.rpc.mock.calls.find((c: any[]) => c[0] === "register_worker_document_revision");
    expect(retryRpc?.[1]?.p_payload?.idempotency_key).toBe(attempt.idempotencyKey);
    expect(out.result.idempotent_hit).toBe(true);
    expect(loadAttempt("w1", "dt1", file)).toBeNull();
  });

  it("removes the orphan storage object and clears the attempt on payload mismatch", async () => {
    const file = makeFile();
    const { attempt } = getOrCreateAttempt("w1", "dt1", file, () => "w1/dt1/only.pdf");
    const client = makeClient({
      rpc: vi.fn(async (name: string) => {
        if (name === "register_worker_document_revision") {
          return { data: null, error: { message: "idempotency_key_payload_mismatch: file changed" } };
        }
        return { data: null, error: null };
      }),
    });

    await expect(
      performIdempotentWorkerDocumentUpload(client as any, {
        workerId: "w1",
        documentTypeId: "dt1",
        file,
        storagePath: attempt.storagePath,
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(IdempotentUploadStageError);

    expect(client._spies.remove).toHaveBeenCalledWith([attempt.storagePath]);
    expect(loadAttempt("w1", "dt1", file)).toBeNull();
  });

  it("keeps the attempt alive when the storage upload itself fails", async () => {
    const file = makeFile();
    const { attempt } = getOrCreateAttempt("w1", "dt1", file, () => "w1/dt1/only.pdf");
    const client = makeClient({
      upload: vi.fn(async () => ({ error: { message: "boom" } })),
    });

    await expect(
      performIdempotentWorkerDocumentUpload(client as any, {
        workerId: "w1",
        documentTypeId: "dt1",
        file,
        storagePath: attempt.storagePath,
        contentType: "application/pdf",
      }),
    ).rejects.toMatchObject({ phase: "storage_upload" });

    expect(client._spies.rpc.mock.calls.filter((c: any[]) => c[0] === "register_worker_document_revision")).toHaveLength(0);
    // Attempt still persisted — retry will reuse the same idempotency key.
    const persisted = loadAttempt("w1", "dt1", file);
    expect(persisted?.idempotencyKey).toBe(attempt.idempotencyKey);
    clearAttempt("w1", "dt1", file);
  });
});