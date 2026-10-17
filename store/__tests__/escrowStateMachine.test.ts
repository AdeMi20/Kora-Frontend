import { describe, it, expect, beforeEach } from "vitest";
import { useTransactionStore } from "../transactionStore";

describe("Escrow State Machine", () => {
  beforeEach(() => {
    useTransactionStore.getState().resetEscrow();
  });

  it("should initialize with default idle state", () => {
    const state = useTransactionStore.getState().escrowState;
    expect(state.step).toBe("idle");
    expect(state.errorStep).toBe(null);
    expect(state.errorMessage).toBe(null);
  });

  it("should transition steps correctly", () => {
    const store = useTransactionStore.getState();
    store.setEscrowStep("buyer_funding");
    expect(useTransactionStore.getState().escrowState.step).toBe("buyer_funding");

    store.setEscrowStep("buyer_funded");
    expect(useTransactionStore.getState().escrowState.step).toBe("buyer_funded");
  });

  it("should set and clear errors", () => {
    const store = useTransactionStore.getState();
    store.setEscrowStep("buyer_funding");
    store.setEscrowError("buyer_funding", "Insufficient funds");

    let state = useTransactionStore.getState().escrowState;
    expect(state.errorStep).toBe("buyer_funding");
    expect(state.errorMessage).toBe("Insufficient funds");

    // Transitioning back to an active retry step clears the error; transitioning
    // to the *next* non-retry step (e.g. buyer_funded) does not, because the
    // store only auto-clears when entering buyer_funding or seller_transferring.
    store.setEscrowStep("buyer_funding");
    state = useTransactionStore.getState().escrowState;
    expect(state.errorStep).toBe(null);
    expect(state.errorMessage).toBe(null);
  });

  it("should reset completely", () => {
    const store = useTransactionStore.getState();
    store.setEscrowStep("seller_transferring");
    store.setEscrowError("seller_transferring", "Network error");
    store.resetEscrow();

    const state = useTransactionStore.getState().escrowState;
    expect(state.step).toBe("idle");
    expect(state.errorStep).toBe(null);
    expect(state.errorMessage).toBe(null);
  });
});
