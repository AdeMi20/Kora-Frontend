import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markWalletVerified, isWalletVerified } from "../verifiedSessions";

const NOW = new Date("2024-01-01T00:00:00Z").getTime();

describe("verifiedSessions (Issue #925)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true while the session has not expired", () => {
    markWalletVerified("0xalice", NOW + 1000 * 60 * 60);
    expect(isWalletVerified("0xalice")).toBe(true);
  });

  it("returns false and clears the session once it has expired", () => {
    markWalletVerified("0xbob", NOW - 1000); // already expired
    expect(isWalletVerified("0xbob")).toBe(false);
  });

  it("returns false for a wallet that was never verified", () => {
    expect(isWalletVerified("0xnever")).toBe(false);
  });

  it("advancing time past expiry flips verified to expired", () => {
    markWalletVerified("0xcarol", NOW + 1000);
    expect(isWalletVerified("0xcarol")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(isWalletVerified("0xcarol")).toBe(false);
  });
});
