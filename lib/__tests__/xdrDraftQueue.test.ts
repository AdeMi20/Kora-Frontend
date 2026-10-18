import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enqueueSignedXdr,
  listQueuedXdrDrafts,
  removeQueuedXdrDraft,
  updateDraftAttempts,
  flushQueuedXdrDrafts,
} from "../xdrDraftQueue";
import type { QueuedXdrDraft } from "../xdrDraftQueue";

const requests: QueuedXdrDraft[] = [];

// Minimal in-memory IDB stand-in so the queue logic can be exercised without
// a real indexedDB implementation.
const fakeDB = {
  objectStoreNames: new Set(["drafts"]),
  createObjectStore(name: string) {
    this.objectStoreNames.add(name);
    return {
      put(draft: QueuedXdrDraft) {
        const i = requests.findIndex((r) => r.id === draft.id);
        if (i === -1) requests.push(draft);
        else requests[i] = draft;
        return { oncomplete: null as any, onerror: null as any };
      },
      getAll() {
        return { result: [...requests] };
      },
      get(id: string) {
        return { result: requests.find((r) => r.id === id) ?? undefined };
      },
      delete(id: string) {
        const i = requests.findIndex((r) => r.id === id);
        if (i !== -1) requests.splice(i, 1);
        return { oncomplete: null as any, onerror: null as any };
      },
      transaction: () => ({
        objectStore: () => ({
          put: (d: QueuedXdrDraft) => {
            const i = requests.findIndex((r) => r.id === d.id);
            if (i === -1) requests.push(d);
            else requests[i] = d;
            return { oncomplete: null as any, onerror: null as any };
          },
          getAll: () => ({ result: [...requests] }),
          get: (id: string) => ({ result: requests.find((r) => r.id === id) }),
          delete: (id: string) => {
            const i = requests.findIndex((r) => r.id === id);
            if (i !== -1) requests.splice(i, 1);
          },
        }),
      }),
    };
  },
  transaction: () => ({
    objectStore: () => ({
      put: (d: QueuedXdrDraft) => {
        const i = requests.findIndex((r) => r.id === d.id);
        if (i === -1) requests.push(d);
        else requests[i] = d;
        return { oncomplete: null as any, onerror: null as any };
      },
      getAll: () => ({ result: [...requests] }),
      get: (id: string) => ({ result: requests.find((r) => r.id === id) }),
      delete: (id: string) => {
        const i = requests.findIndex((r) => r.id === id);
        if (i !== -1) requests.splice(i, 1);
      },
    }),
  }),
  close: () => {},
};

const openReq = {
  result: fakeDB,
  onupgradeneeded: null as any,
  onsuccess: null as any,
  onerror: null as any,
};
const originalIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  requests.length = 0;
  fakeDB.objectStoreNames.clear();
  fakeDB.objectStoreNames.add("drafts");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get: () =>
      ({
        open: () => {
          if (typeof openReq.onupgradeneeded === "function") openReq.onupgradeneeded({ result: fakeDB });
          if (typeof openReq.onsuccess === "function") openReq.onsuccess();
          return openReq;
        },
      } as IDBFactory),
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get: () => originalIndexedDB,
  });
});

describe("xdrDraftQueue (Issue #922)", () => {
  it("enqueues, lists, and removes a signed XDR draft", async () => {
    const draft = await enqueueSignedXdr("BASE64XDR", { type: "fundInvoice" });
    expect(draft.signedXdr).toBe("BASE64XDR");
    expect(draft.attempts).toBe(0);

    const listed = await listQueuedXdrDrafts();
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(draft.id);

    await removeQueuedXdrDraft(draft.id);
    expect((await listQueuedXdrDrafts()).length).toBe(0);
  });

  it("updates attempts and nextRetryAt for an existing draft", async () => {
    const draft = await enqueueSignedXdr("BASE64XDR");
    await updateDraftAttempts(draft.id, 3, Date.now() + 60000);
    const [updated] = await listQueuedXdrDrafts();
    expect(updated.attempts).toBe(3);
    expect(updated.nextRetryAt).toBeGreaterThan(draft.queuedAt);
  });

  it("flushQueuedXdrDrafts removes succeeded drafts and keeps failed ones", async () => {
    await enqueueSignedXdr("XDR-A");
    await enqueueSignedXdr("XDR-B");

    const result = await flushQueuedXdrDrafts(async (draft) => {
      if (draft.signedXdr === "XDR-B") throw new Error("boom");
    });

    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    const remaining = await listQueuedXdrDrafts();
    expect(remaining.length).toBe(1);
    expect(remaining[0].signedXdr).toBe("XDR-B");
  });
});
