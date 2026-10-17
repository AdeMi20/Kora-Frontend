/**
 * Offline queue for already-signed XDR transaction envelopes.
 *
 * The PWA caches pages for offline use, but signing a transaction requires
 * wallet connectivity. This queue stores XDR envelopes that were *already
 * signed while online* so submission can be retried once the connection
 * returns — it never stores private keys or unsigned payloads that would
 * require re-prompting the wallet.
 */

const DB_NAME   = "kora-xdr-queue";
const STORE_NAME = "drafts";

export interface QueuedXdrDraft {
  id: string;
  /** Signed XDR envelope (base64) — never a private key or seed phrase. */
  signedXdr: string;
  /** Free-form context for the UI, e.g. { type: "fundInvoice", invoiceId } */
  meta: Record<string, unknown>;
  queuedAt: number;
  /** How many submission attempts have been made (persisted across refreshes). */
  attempts: number;
  /**
   * Epoch ms of the earliest time the next retry is allowed.
   * Undefined / 0 means "retry immediately" (initial state or after success).
   * Persisted so the cooldown survives a page refresh.
   */
  nextRetryAt?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function enqueueSignedXdr(
  signedXdr: string,
  meta: Record<string, unknown> = {},
): Promise<QueuedXdrDraft> {
  const db = await openDb();
  const draft: QueuedXdrDraft = {
    id: crypto.randomUUID(),
    signedXdr,
    meta,
    queuedAt: Date.now(),
    attempts: 0,
    nextRetryAt: 0,
  };
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(draft);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(draft);
    tx.onerror    = () => reject(tx.error);
  });
}

export async function listQueuedXdrDrafts(): Promise<QueuedXdrDraft[]> {
  const db  = await openDb();
  const tx  = db.transaction(STORE_NAME, "readonly");
  const req = tx.objectStore(STORE_NAME).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as QueuedXdrDraft[]) ?? []);
    req.onerror   = () => reject(req.error);
  });
}

export async function removeQueuedXdrDraft(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/**
 * Persist updated attempt count and next-retry timestamp for a single draft.
 *
 * Called by PendingTxQueuePanel after each failed submission so that the
 * backoff schedule survives a page refresh without losing state.
 */
export async function updateDraftAttempts(
  id: string,
  attempts: number,
  nextRetryAt: number,
): Promise<void> {
  const db    = await openDb();
  const readTx = db.transaction(STORE_NAME, "readonly");
  const getReq = readTx.objectStore(STORE_NAME).get(id);

  const existing = await new Promise<QueuedXdrDraft | undefined>((resolve, reject) => {
    getReq.onsuccess = () => resolve(getReq.result as QueuedXdrDraft | undefined);
    getReq.onerror   = () => reject(getReq.error);
  });

  if (!existing) return;

  const updated: QueuedXdrDraft = { ...existing, attempts, nextRetryAt };
  const writeTx = db.transaction(STORE_NAME, "readwrite");
  writeTx.objectStore(STORE_NAME).put(updated);
  return new Promise((resolve, reject) => {
    writeTx.oncomplete = () => resolve();
    writeTx.onerror    = () => reject(writeTx.error);
  });
}

/**
 * Resubmits every queued draft using the provided submit function, removing
 * each draft on success and leaving it queued (with attempts incremented)
 * on failure so it can be retried on the next reconnect.
 */
export async function flushQueuedXdrDrafts(
  submit: (draft: QueuedXdrDraft) => Promise<void>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const drafts   = await listQueuedXdrDrafts();
  const succeeded: string[] = [];
  const failed:    string[] = [];

  for (const draft of drafts) {
    try {
      await submit(draft);
      await removeQueuedXdrDraft(draft.id);
      succeeded.push(draft.id);
    } catch {
      failed.push(draft.id);
    }
  }

  return { succeeded, failed };
}

/** Convenience: call from a `window.addEventListener("online", ...)` handler. */
export function registerXdrQueueOnlineFlush(
  submit: (draft: QueuedXdrDraft) => Promise<void>,
): () => void {
  const handler = () => {
    void flushQueuedXdrDrafts(submit);
  };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}
