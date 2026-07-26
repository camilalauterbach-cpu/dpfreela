// Reenvio seguro e idempotente de documentos worker-scoped.
//
// Um "attempt" é uma tentativa lógica de gravar UMA revisão para
// (worker_id, document_type_id, arquivo). Enquanto o attempt existir na
// sessionStorage, qualquer nova tentativa REUSA:
//   - a mesma `idempotency_key` (a RPC canônica devolve `idempotent_hit`
//     em vez de gravar de novo, ou rejeita com `idempotency_key_payload_mismatch`
//     caso o payload tenha mudado — nunca duplica);
//   - o mesmo `storage path` (upsert reescreve o mesmo objeto, evitando
//     arquivos órfãos e blobs pendurados por falhas transientes).
//
// Ao final:
//   - sucesso ou `idempotent_hit`  → attempt é consumido (session limpa);
//   - falha terminal não-transiente → objeto do storage é removido e attempt é
//     limpo, garantindo ausência de arquivos órfãos;
//   - falha transiente durante tentativas intermediárias → attempt permanece
//     na session e o próximo retry (manual ou automático) reusa a chave.

import {
  registerWorkerDocumentRevision,
  type WorkerDocumentRevisionOperation,
  type WorkerDocumentRevisionRpcResult,
} from "@/lib/worker-document-revisions";
import { logWorkerDocumentRevisionEvent } from "@/lib/worker-document-revision-events";

type SupabaseLike = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File | Blob,
        opts?: { upsert?: boolean; contentType?: string },
      ) => Promise<{ error: unknown }>;
      remove: (paths: string[]) => Promise<{ error: unknown }>;
    };
  };
};

export interface UploadAttempt {
  idempotencyKey: string;
  storagePath: string;
  createdAt: string;
  attempts: number;
}

const ATTEMPT_PREFIX = "wdr-attempt:v1:";

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function fingerprintFile(file: File): string {
  // Não é um hash criptográfico — o objetivo é apenas casar retries do MESMO
  // arquivo. A RPC valida o payload real via `idempotency_key_payload_mismatch`.
  return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

function attemptKey(workerId: string, documentTypeId: string, file: File): string {
  return `${ATTEMPT_PREFIX}${workerId}:${documentTypeId}:${fingerprintFile(file)}`;
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = Number(c);
    const r = Math.trunc(Math.random() * 256);
    return (n ^ (r & (15 >> (n / 4)))).toString(16);
  });
}

export function loadAttempt(workerId: string, documentTypeId: string, file: File): UploadAttempt | null {
  const store = safeSessionStorage();
  if (!store) return null;
  const raw = store.getItem(attemptKey(workerId, documentTypeId, file));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UploadAttempt;
    if (parsed && typeof parsed.idempotencyKey === "string" && typeof parsed.storagePath === "string") {
      return parsed;
    }
  } catch {
    /* corrupted entry — discard */
  }
  return null;
}

function saveAttempt(workerId: string, documentTypeId: string, file: File, attempt: UploadAttempt) {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(attemptKey(workerId, documentTypeId, file), JSON.stringify(attempt));
  } catch {
    /* quota / private mode — silent, retries still work in-memory */
  }
}

export function clearAttempt(workerId: string, documentTypeId: string, file: File) {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.removeItem(attemptKey(workerId, documentTypeId, file));
  } catch {
    /* silent */
  }
}

export function getOrCreateAttempt(
  workerId: string,
  documentTypeId: string,
  file: File,
  buildStoragePath: () => string,
): { attempt: UploadAttempt; replay: boolean } {
  const existing = loadAttempt(workerId, documentTypeId, file);
  if (existing) {
    const bumped: UploadAttempt = { ...existing, attempts: existing.attempts + 1 };
    saveAttempt(workerId, documentTypeId, file, bumped);
    return { attempt: bumped, replay: true };
  }
  const fresh: UploadAttempt = {
    idempotencyKey: randomUuid(),
    storagePath: buildStoragePath(),
    createdAt: new Date().toISOString(),
    attempts: 1,
  };
  saveAttempt(workerId, documentTypeId, file, fresh);
  return { attempt: fresh, replay: false };
}

// Uma resposta é "idempotent hit" quando a RPC detectou a mesma chave.
// A RPC também sinaliza sucesso com `document` populado — nos dois casos
// o attempt está consumido e pode ser limpo.
function isTerminalSuccess(result: WorkerDocumentRevisionRpcResult): boolean {
  return !!result && (result.idempotent_hit === true || !!result.document);
}

// Erro NÃO retryável — payload mudou entre tentativas. Nunca duplicar:
// derruba o attempt e obriga o usuário a começar do zero.
function isPayloadMismatch(err: unknown): boolean {
  const msg = (err as any)?.message ?? "";
  return typeof msg === "string" && msg.includes("idempotency_key_payload_mismatch");
}

export interface IdempotentUploadInput {
  workerId: string;
  documentTypeId: string;
  currentDocumentId?: string | null;
  file: File;
  storagePath: string; // já resolvido pelo chamador; combina com o attempt
  bucket?: string;
  contentType: string;
  status?: "pending" | "uploaded" | "approved" | "rejected" | "replace";
  operation?: WorkerDocumentRevisionOperation;
  issuedAt?: string | null;
  explicitExpiresAt?: string | null;
  documentNumber?: string | null;
  issuingAuthority?: string | null;
  notes?: string | null;
  revisionReason?: string | null;
  category?: string;
}

export type UploadStagePhase = "storage_upload" | "db_registration";

export class IdempotentUploadStageError extends Error {
  constructor(
    public phase: UploadStagePhase,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "IdempotentUploadStageError";
  }
}

export interface IdempotentUploadOutcome {
  result: WorkerDocumentRevisionRpcResult;
  storagePath: string;
  idempotencyKey: string;
  attempts: number;
  replay: boolean;
}

/**
 * Executa upload + RPC canônica com idempotência estável entre retries.
 *
 * Contrato:
 *  - Chame `getOrCreateAttempt` antes e passe o `storagePath` retornado
 *    (idem para o `idempotencyKey`, injetado internamente).
 *  - Ao final o attempt é consumido em caso de sucesso OU falha terminal.
 *    Se a falha for transiente (ex.: rede caiu no meio da RPC), o attempt
 *    permanece — o próximo clique do usuário reusa a mesma chave.
 */
export async function performIdempotentWorkerDocumentUpload(
  client: SupabaseLike,
  input: IdempotentUploadInput,
): Promise<IdempotentUploadOutcome> {
  const bucket = input.bucket ?? "worker-documents";
  const { workerId, documentTypeId, file, storagePath, contentType } = input;

  const persisted = loadAttempt(workerId, documentTypeId, file);
  const attempt = persisted && persisted.storagePath === storagePath
    ? persisted
    : (() => {
        // Chamador não passou pelo helper — cria/adota agora com este path.
        const fresh: UploadAttempt = {
          idempotencyKey: randomUuid(),
          storagePath,
          createdAt: new Date().toISOString(),
          attempts: 1,
        };
        saveAttempt(workerId, documentTypeId, file, fresh);
        return fresh;
      })();
  const replay = !!persisted;

  await logWorkerDocumentRevisionEvent(client, {
    workerId,
    documentTypeId,
    event: replay ? "client_note" : "upload_started",
    idempotencyKey: attempt.idempotencyKey,
    details: {
      category: input.category ?? null,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      attempt: attempt.attempts,
      replay,
      ...(replay ? { reason: "retry_reuses_attempt" } : {}),
    },
  });

  // Storage upload — sempre com upsert para tolerar reenvio do mesmo objeto.
  // Como storagePath é estável por attempt, isso NÃO cria arquivos novos.
  const uploadRes = await client.storage.from(bucket).upload(storagePath, file, {
    upsert: true,
    contentType,
  });
  if (uploadRes.error) {
    await logWorkerDocumentRevisionEvent(client, {
      workerId,
      documentTypeId,
      event: "storage_upload_failed",
      status: "error",
      idempotencyKey: attempt.idempotencyKey,
      details: {
        category: input.category ?? null,
        file_name: file.name,
        attempt: attempt.attempts,
        error: (uploadRes.error as any)?.message ?? String(uploadRes.error),
      },
    });
    // Falha antes de gravar no banco — o attempt sobrevive para próximo retry.
    throw new IdempotentUploadStageError(
      "storage_upload",
      (uploadRes.error as any)?.message || "Falha no upload para o Storage.",
      uploadRes.error,
    );
  }
  await logWorkerDocumentRevisionEvent(client, {
    workerId,
    documentTypeId,
    event: "storage_uploaded",
    idempotencyKey: attempt.idempotencyKey,
    details: {
      category: input.category ?? null,
      file_name: file.name,
      file_size: file.size,
      file_path: storagePath,
      attempt: attempt.attempts,
    },
  });

  try {
    const result = await registerWorkerDocumentRevision(client, {
      workerId,
      documentTypeId,
      currentDocumentId: input.currentDocumentId ?? null,
      filePath: storagePath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: contentType,
      status: input.status ?? "uploaded",
      operation: input.operation,
      issuedAt: input.issuedAt ?? null,
      explicitExpiresAt: input.explicitExpiresAt ?? null,
      documentNumber: input.documentNumber ?? null,
      issuingAuthority: input.issuingAuthority ?? null,
      notes: input.notes ?? null,
      revisionReason: input.revisionReason ?? null,
      idempotencyKey: attempt.idempotencyKey,
    });

    if (isTerminalSuccess(result)) {
      clearAttempt(workerId, documentTypeId, file);
    }
    return {
      result,
      storagePath,
      idempotencyKey: attempt.idempotencyKey,
      attempts: attempt.attempts,
      replay,
    };
  } catch (rpcErr) {
    const mismatch = isPayloadMismatch(rpcErr);

    await logWorkerDocumentRevisionEvent(client, {
      workerId,
      documentTypeId,
      event: "db_persist_failed",
      status: "error",
      idempotencyKey: attempt.idempotencyKey,
      details: {
        category: input.category ?? null,
        file_name: file.name,
        file_path: storagePath,
        attempt: attempt.attempts,
        payload_mismatch: mismatch,
        error: (rpcErr as any)?.message ?? String(rpcErr),
      },
    });

    if (mismatch) {
      // Attempt corrompido: o usuário mudou algum campo entre tentativas.
      // Limpa storage E attempt para permitir uma nova chave limpa.
      await client.storage.from(bucket).remove([storagePath]).catch(() => {});
      clearAttempt(workerId, documentTypeId, file);
      throw new IdempotentUploadStageError(
        "db_registration",
        "Os dados do documento mudaram desde a tentativa anterior. Recomece o envio para gerar uma nova revisão.",
        rpcErr,
      );
    }

    // Falha genérica no lado do banco — mantém o attempt para permitir
    // reenvio idempotente pelo mesmo usuário (mesmo arquivo/mesma chave).
    // O arquivo permanece no storage no mesmo path; próximo retry fará
    // upsert e a RPC devolverá idempotent_hit caso o registro já exista.
    throw new IdempotentUploadStageError(
      "db_registration",
      (rpcErr as any)?.message || "Falha ao registrar a revisão do documento.",
      rpcErr,
    );
  }
}

/**
 * Utilitário para chamadores que decidiram desistir de um attempt em progresso
 * (ex.: usuário fecha o drawer). Remove o objeto órfão do storage e limpa a
 * chave de sessão.
 */
export async function abandonAttempt(
  client: SupabaseLike,
  workerId: string,
  documentTypeId: string,
  file: File,
  bucket = "worker-documents",
): Promise<void> {
  const attempt = loadAttempt(workerId, documentTypeId, file);
  if (!attempt) return;
  await client.storage.from(bucket).remove([attempt.storagePath]).catch(() => {});
  clearAttempt(workerId, documentTypeId, file);
}