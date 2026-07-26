export type WorkerDocumentRevisionOperation = "initial" | "renewal" | "replacement" | "correction";

export interface WorkerDocumentRevisionPayloadInput {
  workerId: string;
  documentTypeId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status?: "pending" | "uploaded" | "approved" | "rejected" | "replace";
  currentDocumentId?: string | null;
  operation?: WorkerDocumentRevisionOperation;
  issuedAt?: string | null;
  explicitExpiresAt?: string | null;
  documentNumber?: string | null;
  issuingAuthority?: string | null;
  notes?: string | null;
  revisionReason?: string | null;
  idempotencyKey?: string;
}

export interface WorkerDocumentRevisionRpcResult {
  idempotent_hit?: boolean;
  document?: Record<string, unknown>;
  trace_id?: string;
  lock_wait_ms?: number;
  lock_held_ms?: number;
}

function randomIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = Number(c);
    const random = Math.trunc(Math.random() * 256);
    return (n ^ (random & (15 >> (n / 4)))).toString(16);
  });
}

export function buildWorkerDocumentRevisionPayload(input: WorkerDocumentRevisionPayloadInput) {
  const hasCurrent = !!input.currentDocumentId;
  const operation = input.operation ?? (hasCurrent ? "renewal" : "initial");

  return {
    worker_id: input.workerId,
    document_type_id: input.documentTypeId,
    operation,
    expected_current_document_id: input.currentDocumentId ?? null,
    idempotency_key: input.idempotencyKey ?? randomIdempotencyKey(),
    file_path: input.filePath,
    file_name: input.fileName,
    file_size: input.fileSize,
    mime_type: input.mimeType,
    issued_at: input.issuedAt || null,
    explicit_expires_at: input.explicitExpiresAt || null,
    document_number: input.documentNumber?.trim() || null,
    issuing_authority: input.issuingAuthority?.trim() || null,
    notes: input.notes?.trim() || null,
    revision_reason: input.revisionReason?.trim() || null,
    status: input.status ?? "uploaded",
  };
}

export async function registerWorkerDocumentRevision(
  client: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  input: WorkerDocumentRevisionPayloadInput,
): Promise<WorkerDocumentRevisionRpcResult> {
  const payload = buildWorkerDocumentRevisionPayload(input);
  const { data, error } = await client.rpc("register_worker_document_revision", { p_payload: payload });
  if (error) throw error;
  return (data ?? {}) as WorkerDocumentRevisionRpcResult;
}
