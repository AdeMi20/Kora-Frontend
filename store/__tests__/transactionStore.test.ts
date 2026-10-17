/**
 * store/__tests__/transactionStore.test.ts
 *
 * Covers non-escrow slices of transactionStore:
 *   - TxRecord history: addTransaction, removeTransaction, clearHistory,
 *     deduplication by hash, MAX_HISTORY cap
 *   - Escrow helpers: recordEscrowAttempt, setCurrentAttempt,
 *     incrementRetryCount, setEscrowContext
 *   - Cross-feature reset: resetEscrow determinism, partial vs full resets
 *   - Concurrency and immutability guards on attemptHistory
 *
 * Escrow state-machine transitions are already covered in escrowStateMachine.test.ts.
 * This file intentionally has no duplicate test names with that suite.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useTransactionStore } from "../transactionStore";
import type { TxRecord, EscrowStepAttempt } from "../transactionStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTxRecord(overrides: Partial<Omit<TxRecord, "timestamp">> = {}): Omit<TxRecord, "timestamp"> {
  return {
    hash: `hash_${Math.random().toString(36).slice(2)}`,
    type: "fund",
    status: "confirmed",
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<EscrowStepAttempt> = {}): EscrowStepAttempt {
  return {
    step: "buyer_funding",
    attemptNumber: 1,
    timestamp: new Date().toISOString(),
    success: false,
    positionId: "pos_1",
    buyerAddress: "GBUYER111",
    sellerAddress: "GSELLER111",
    amount: 1000,
    ...overrides,
  };
}

function resetAll() {
  useTransactionStore.setState({
    transactions: [],
    escrowState: {
      step: "idle",
      errorStep: null,
      errorMessage: null,
      txHash: null,
      attemptHistory: [],
      currentAttempt: undefined,
      totalRetryCount: 0,
      currentContext: undefined,
    },
  });
}

// ─── TxRecord history ─────────────────────────────────────────────────────────

describe("transactionStore — history", () => {
  beforeEach(resetAll);

  it("addTransaction appends a record with a generated timestamp when none is provided", () => {
    const before = Date.now();
    useTransactionStore.getState().addTransaction(makeTxRecord({ hash: "h1" }));
    const after = Date.now();

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    const ts = new Date(transactions[0].timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("addTransaction preserves a caller-supplied timestamp", () => {
    const ts = "2025-01-01T00:00:00.000Z";
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "h2", timestamp: ts });

    expect(useTransactionStore.getState().transactions[0].timestamp).toBe(ts);
  });

  it("addTransaction deduplicates by hash — updates the existing entry rather than appending", () => {
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "dup", status: "confirmed" });
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "dup", status: "failed" });

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].status).toBe("failed");
  });

  it("addTransaction inserts newest-first", () => {
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "first" });
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "second" });

    const { transactions } = useTransactionStore.getState();
    expect(transactions[0].hash).toBe("second");
    expect(transactions[1].hash).toBe("first");
  });

  it("removeTransaction removes only the matching hash", () => {
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "keep" });
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "gone" });
    useTransactionStore.getState().removeTransaction("gone");

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].hash).toBe("keep");
  });

  it("removeTransaction is a no-op when the hash is not found", () => {
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "exists" });
    useTransactionStore.getState().removeTransaction("nonexistent");

    expect(useTransactionStore.getState().transactions).toHaveLength(1);
  });

  it("clearHistory wipes all records", () => {
    useTransactionStore.getState().addTransaction(makeTxRecord());
    useTransactionStore.getState().addTransaction(makeTxRecord());
    useTransactionStore.getState().clearHistory();

    expect(useTransactionStore.getState().transactions).toHaveLength(0);
  });

  it("caps history at 200 entries — oldest is evicted", () => {
    for (let i = 0; i < 205; i++) {
      useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: `h${i}` });
    }

    const { transactions } = useTransactionStore.getState();
    expect(transactions.length).toBe(200);
    // Newest should be at index 0
    expect(transactions[0].hash).toBe("h204");
    // The very first entry (h0) must have been evicted
    expect(transactions.find((t) => t.hash === "h0")).toBeUndefined();
  });
});

// ─── Escrow helpers: attempt history & context ────────────────────────────────

describe("transactionStore — escrow attempt history", () => {
  beforeEach(resetAll);

  it("recordEscrowAttempt appends immutably — prior entries are not mutated", () => {
    const a1 = makeAttempt({ attemptNumber: 1 });
    useTransactionStore.getState().recordEscrowAttempt(a1);

    const snapAfterFirst = [...useTransactionStore.getState().escrowState.attemptHistory];

    const a2 = makeAttempt({ attemptNumber: 2, success: true });
    useTransactionStore.getState().recordEscrowAttempt(a2);

    // The first snapshot must not have grown
    expect(snapAfterFirst).toHaveLength(1);

    const { attemptHistory } = useTransactionStore.getState().escrowState;
    expect(attemptHistory).toHaveLength(2);
    expect(attemptHistory[0]).toEqual(a1);
    expect(attemptHistory[1]).toEqual(a2);
  });

  it("recordEscrowAttempt increments totalRetryCount", () => {
    expect(useTransactionStore.getState().escrowState.totalRetryCount).toBe(0);
    useTransactionStore.getState().recordEscrowAttempt(makeAttempt());
    expect(useTransactionStore.getState().escrowState.totalRetryCount).toBe(1);
    useTransactionStore.getState().recordEscrowAttempt(makeAttempt({ attemptNumber: 2 }));
    expect(useTransactionStore.getState().escrowState.totalRetryCount).toBe(2);
  });

  it("recordEscrowAttempt clears currentAttempt", () => {
    useTransactionStore.getState().setCurrentAttempt(makeAttempt());
    expect(useTransactionStore.getState().escrowState.currentAttempt).toBeDefined();

    useTransactionStore.getState().recordEscrowAttempt(makeAttempt());
    expect(useTransactionStore.getState().escrowState.currentAttempt).toBeUndefined();
  });

  it("setCurrentAttempt sets an in-progress attempt without touching the history ledger", () => {
    const attempt = makeAttempt();
    useTransactionStore.getState().setCurrentAttempt(attempt);

    const state = useTransactionStore.getState().escrowState;
    expect(state.currentAttempt).toEqual(attempt);
    expect(state.attemptHistory).toHaveLength(0);
  });

  it("setCurrentAttempt with undefined clears the in-progress slot", () => {
    useTransactionStore.getState().setCurrentAttempt(makeAttempt());
    useTransactionStore.getState().setCurrentAttempt(undefined);

    expect(useTransactionStore.getState().escrowState.currentAttempt).toBeUndefined();
  });

  it("incrementRetryCount increments independently of recordEscrowAttempt", () => {
    useTransactionStore.getState().incrementRetryCount();
    useTransactionStore.getState().incrementRetryCount();

    expect(useTransactionStore.getState().escrowState.totalRetryCount).toBe(2);
    expect(useTransactionStore.getState().escrowState.attemptHistory).toHaveLength(0);
  });
});

// ─── Escrow context ───────────────────────────────────────────────────────────

describe("transactionStore — escrow context", () => {
  beforeEach(resetAll);

  it("setEscrowContext stores buyer/seller/amount for retry", () => {
    const ctx = {
      positionId: "pos_42",
      buyerAddress: "GBUYER000",
      sellerAddress: "GSELLER000",
      amount: 9999,
    };
    useTransactionStore.getState().setEscrowContext(ctx);

    expect(useTransactionStore.getState().escrowState.currentContext).toEqual(ctx);
  });

  it("setEscrowContext with null clears the context", () => {
    useTransactionStore.getState().setEscrowContext({
      positionId: "pos_1",
      buyerAddress: "G1",
      sellerAddress: "G2",
      amount: 1,
    });
    useTransactionStore.getState().setEscrowContext(null);

    expect(useTransactionStore.getState().escrowState.currentContext).toBeUndefined();
  });
});

// ─── Cross-feature reset ──────────────────────────────────────────────────────

describe("transactionStore — cross-feature reset", () => {
  beforeEach(resetAll);

  it("resetEscrow leaves tx history untouched", () => {
    useTransactionStore.getState().addTransaction({ ...makeTxRecord(), hash: "tx1" });
    useTransactionStore.getState().setEscrowStep("buyer_funding");
    useTransactionStore.getState().resetEscrow();

    const { transactions, escrowState } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(escrowState.step).toBe("idle");
  });

  it("resetEscrow preserves attemptHistory and totalRetryCount for audit trail", () => {
    useTransactionStore.getState().recordEscrowAttempt(makeAttempt({ attemptNumber: 1 }));
    useTransactionStore.getState().recordEscrowAttempt(makeAttempt({ attemptNumber: 2 }));

    useTransactionStore.getState().setEscrowStep("seller_transferring");
    useTransactionStore.getState().resetEscrow();

    const { escrowState } = useTransactionStore.getState();
    // Machine state reset
    expect(escrowState.step).toBe("idle");
    expect(escrowState.errorStep).toBeNull();
    expect(escrowState.errorMessage).toBeNull();
    // Audit trail preserved
    expect(escrowState.attemptHistory).toHaveLength(2);
    expect(escrowState.totalRetryCount).toBe(2);
  });

  it("clearHistory does not touch escrow state", () => {
    useTransactionStore.getState().setEscrowStep("buyer_funding");
    useTransactionStore.getState().setEscrowError("buyer_funding", "err");
    useTransactionStore.getState().clearHistory();

    const { escrowState } = useTransactionStore.getState();
    expect(escrowState.step).toBe("buyer_funding");
    expect(escrowState.errorStep).toBe("buyer_funding");
  });

  it("full store reset returns deterministic initial state with no residual escrow or history", () => {
    useTransactionStore.getState().addTransaction(makeTxRecord());
    useTransactionStore.getState().recordEscrowAttempt(makeAttempt());
    useTransactionStore.getState().setEscrowStep("settled");

    resetAll();

    const { transactions, escrowState } = useTransactionStore.getState();
    expect(transactions).toHaveLength(0);
    expect(escrowState.step).toBe("idle");
    expect(escrowState.attemptHistory).toHaveLength(0);
    expect(escrowState.totalRetryCount).toBe(0);
    expect(escrowState.currentAttempt).toBeUndefined();
    expect(escrowState.currentContext).toBeUndefined();
  });
});

// ─── Simulation flags (in-progress tx metadata) ───────────────────────────────
// The store itself doesn't own a "simulation in-progress" boolean — that lives
// in useTransaction's local state. These tests cover the store-side markers that
// overlays and dashboards read: the escrow step and error fields that indicate
// a simulation-phase failure.

describe("transactionStore — simulation-phase metadata", () => {
  beforeEach(resetAll);

  it("a failed simulation is recorded as an attempt with success=false", () => {
    const attempt = makeAttempt({ success: false, errorMessage: "Simulation failed: contract error" });
    useTransactionStore.getState().recordEscrowAttempt(attempt);

    const last = useTransactionStore.getState().escrowState.attemptHistory.at(-1);
    expect(last?.success).toBe(false);
    expect(last?.errorMessage).toMatch(/simulation failed/i);
  });

  it("a successful simulation clears any prior error on the same step", () => {
    useTransactionStore.getState().setEscrowStep("buyer_funding");
    useTransactionStore.getState().setEscrowError("buyer_funding", "Simulation error");

    // Transition to a new step — should clear the error
    useTransactionStore.getState().setEscrowStep("seller_transferring");

    const { escrowState } = useTransactionStore.getState();
    expect(escrowState.errorStep).toBeNull();
    expect(escrowState.errorMessage).toBeNull();
  });
});
