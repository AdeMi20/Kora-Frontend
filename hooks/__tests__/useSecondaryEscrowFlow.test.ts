import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSecondaryEscrowFlow } from "../useTransaction";

const mockSetEscrowStep = vi.fn();
const mockSetEscrowError = vi.fn();
const mockResetEscrow = vi.fn();
const mockExecute = vi.fn();

vi.mock("@/store/transactionStore", () => ({
  useTransactionStore: () => ({
    escrowState: { errorStep: null, attemptHistory: [], totalRetryCount: 0 },
    setEscrowStep: mockSetEscrowError,
    setEscrowError: mockSetEscrowError,
    resetEscrow: mockResetEscrow,
  }),
}));

vi.mock("../useTransaction", () => ({
  useTransaction: () => ({
    execute: mockExecute,
  }),
}));

vi.mock("@/services/invoiceService", () => ({
  prepareTransferPosition: vi.fn().mockResolvedValue(undefined),
}));

describe("useSecondaryEscrowFlow (Issue #921)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startEscrow advances through steps and returns true on success", async () => {
    mockExecute.mockResolvedValue(true);
    const { result } = renderHook(() => useSecondaryEscrowFlow());
    await act(async () => {
      const ok = await result.current.startEscrow(
        "pos-1",
        "buyer",
        "seller",
        1000,
      );
      expect(ok).toBe(true);
    });
    expect(mockExecute).toHaveBeenCalled();
    expect(mockSetEscrowStep).toHaveBeenCalledWith("settled");
  });

  it("retryEscrow retries from buyer_funding when that is the error step", async () => {
    const store = vi.mocked(require("@/store/transactionStore").useTransactionStore);
    store.mockReturnValue({
      escrowState: { errorStep: "buyer_funding", attemptHistory: [], totalRetryCount: 0 },
      setEscrowStep: mockSetEscrowStep,
      setEscrowError: mockSetEscrowError,
      resetEscrow: mockResetEscrow,
    } as any);
    mockExecute.mockResolvedValue(true);
    const { result } = renderHook(() => useSecondaryEscrowFlow());
    await act(async () => {
      const ok = await result.current.retryEscrow("pos-1", "buyer", "seller", 1000);
      expect(ok).toBe(true);
    });
    expect(mockSetEscrowError).toHaveBeenCalledWith(null, null);
  });
});
