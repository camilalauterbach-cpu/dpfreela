// Registrador de eventos da trilha de auditoria de revisões de documentos
// do trabalhador. Emitido pelo cliente para as fases que acontecem antes
// da RPC canônica (start, upload no Storage, falhas) e complementa os
// eventos que a própria RPC grava (db_persisted, became_current,
// superseded, idempotent_hit).
//
// Escrita "best-effort": erros de log NÃO devem quebrar o fluxo de upload.

export type RevisionEventName =
  | "upload_started"
  | "storage_uploaded"
  | "storage_upload_failed"
  | "db_persisted"
  | "db_persist_failed"
  | "became_current"
  | "superseded"
  | "idempotent_hit"
  | "client_error"
  | "client_note";

export type RevisionEventStatus = "ok" | "error" | "warn";

export interface LogRevisionEventInput {
  workerId: string;
  documentTypeId: string;
  event: RevisionEventName;
  status?: RevisionEventStatus;
  revisionId?: string | null;
  idempotencyKey?: string | null;
  traceId?: string | null;
  details?: Record<string, unknown>;
  occurredAt?: string;
}

export async function logWorkerDocumentRevisionEvent(
  client: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  input: LogRevisionEventInput,
): Promise<void> {
  try {
    await client.rpc("log_worker_document_revision_event", {
      p_payload: {
        worker_id: input.workerId,
        document_type_id: input.documentTypeId,
        event: input.event,
        status: input.status ?? "ok",
        revision_id: input.revisionId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        trace_id: input.traceId ?? null,
        details: input.details ?? {},
        occurred_at: input.occurredAt ?? null,
      },
    });
  } catch (err) {
    // Log-only path: never break the upload flow because of an audit
    // event failure. Surface to console for debugging.
    // eslint-disable-next-line no-console
    console.warn("[revision-audit] failed to log event", input.event, err);
  }
}