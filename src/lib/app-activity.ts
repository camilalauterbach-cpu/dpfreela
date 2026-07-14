// App-wide activity tracker with unique per-operation IDs.
//
// Used to decide whether it is safe to trigger a hard `location.reload()`
// (e.g. after a stale chunk is detected or a new deploy is announced) and
// whether to install a `beforeunload` guard.
//
// Design: we intentionally avoid a plain counter (incr/decr) because a
// duplicated cleanup, an unmounted component, or an out-of-order finish would
// leave the tracker permanently non-zero (or negative). Sets keyed by a stable
// per-operation ID are idempotent — deleting the same ID twice is a no-op.

type ActivityKind = "mutation" | "form" | "upload";

const buckets: Record<ActivityKind, Set<string>> = {
  mutation: new Set(),
  form: new Set(),
  upload: new Set(),
};

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // never let a listener break the tracker
    }
  });
}

let idSeq = 0;
function nextId(prefix: string) {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

function beginRaw(kind: ActivityKind, id: string) {
  buckets[kind].add(id);
  notify();
  updateBeforeUnload();
}

function endRaw(kind: ActivityKind, id: string) {
  const removed = buckets[kind].delete(id);
  if (removed) {
    notify();
    updateBeforeUnload();
  }
}

export function beginMutation(id?: string): string {
  const opId = id ?? nextId("mut");
  beginRaw("mutation", opId);
  return opId;
}
export function endMutation(id: string) {
  endRaw("mutation", id);
}

export function beginUpload(id?: string): string {
  const opId = id ?? nextId("upl");
  beginRaw("upload", opId);
  return opId;
}
export function endUpload(id: string) {
  endRaw("upload", id);
}

export function markFormDirty(id: string) {
  beginRaw("form", id);
}
export function markFormClean(id: string) {
  endRaw("form", id);
}

export function isBusy(): boolean {
  return (
    buckets.mutation.size > 0 ||
    buckets.form.size > 0 ||
    buckets.upload.size > 0
  );
}

export function getBusySnapshot() {
  return {
    mutations: buckets.mutation.size,
    dirtyForms: buckets.form.size,
    uploads: buckets.upload.size,
  };
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- beforeunload guard (only active while there is real work) ----

function beforeUnloadHandler(e: BeforeUnloadEvent) {
  // Standard trick: setting returnValue triggers the browser's native
  // "changes you made may not be saved" prompt. The exact string is ignored.
  e.preventDefault();
  e.returnValue = "";
  return "";
}

let beforeUnloadInstalled = false;
function updateBeforeUnload() {
  if (typeof window === "undefined") return;
  const busy = isBusy();
  if (busy && !beforeUnloadInstalled) {
    window.addEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadInstalled = true;
  } else if (!busy && beforeUnloadInstalled) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadInstalled = false;
  }
}