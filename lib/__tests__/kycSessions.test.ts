import { describe, it, expect, beforeEach } from "vitest";
import {
  setKycStatus,
  getKycStatus,
  clearKycStatuses,
} from "../kycSessions";

type KycStatus = "pending" | "approved" | "rejected";

describe("kycSessions (Issue #924)", () => {
  beforeEach(() => {
    clearKycStatuses();
  });

  it("records the first status and keeps it when a stale out-of-order retry arrives", () => {
    setKycStatus("0xalice", "approved", "sess-1", 1000);
    setKycStatus("0xalice", "pending", "sess-2", 500); // older timestamp
    const record = getKycStatus("0xalice");
    expect(record?.status).toBe("approved");
    expect(record?.sessionId).toBe("sess-1");
    expect(record?.updatedAt).toBe(1000);
  });

  it("advances to a later status when the newer timestamp arrives first", () => {
    setKycStatus("0xbob", "pending", "sess-1", 1000);
    setKycStatus("0xbob", "approved", "sess-2", 2000);
    expect(getKycStatus("0xbob")?.status).toBe("approved");
    expect(getKycStatus("0xbob")?.sessionId).toBe("sess-2");
  });

  it("retains the latest timestamp on equal timestamps", () => {
    setKycStatus("0xcarol", "pending", "sess-1", 1000);
    setKycStatus("0xcarol", "approved", "sess-2", 1000);
    expect(getKycStatus("0xcarol")?.sessionId).toBe("sess-2");
  });

  it("returns null for a wallet with no record", () => {
    expect(getKycStatus("0xnobody")).toBeNull();
  });
});
