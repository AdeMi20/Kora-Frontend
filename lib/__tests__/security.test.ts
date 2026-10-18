import { describe, expect, it } from "vitest";
import {
  parseWalletDiagnosticsImport,
  redactWalletAddress,
  sanitizeWalletDiagnosticsExport,
  sanitizeQueryParam,
} from "../security";

describe("wallet diagnostics security helpers", () => {
  it("redacts full wallet addresses", () => {
    expect(
      redactWalletAddress("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
    ).toBe("GA5Z...KZVN");
  });

  it("sanitizes export payloads without leaking raw addresses", () => {
    const payload = sanitizeWalletDiagnosticsExport({
      exportedAt: "2026-08-27T00:00:00.000Z",
      network: "testnet",
      wallet: {
        provider: "freighter",
        isConnected: true,
        addressSuffix:
          "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        walletNetwork: "testnet",
        passphraseMismatch: false,
        kitSessionActive: true,
      },
      flags: {
        enableDevtools: true,
        enableInvoiceComparison: true,
      },
    });

    expect(payload.wallet.addressSuffix).toBe("GA5Z...KZVN");
  });

  it("parses imports with missing fields safely", () => {
    const imported = parseWalletDiagnosticsImport("{\"network\":\"testnet\"}");
    expect(imported.network).toBe("testnet");
    expect(imported.wallet.provider).toBeNull();
    expect(imported.flags.enableDevtools).toBe(false);
  });
});

describe("sanitizeQueryParam fuzz (Issue #960)", () => {
  it("rejects control characters and non-printable bytes", () => {
    expect(sanitizeQueryParam("a\u0000b\u001fc")).toBe("abc");
  });

  it("rejects surrogate pairs and non-ASCII without throwing", () => {
    expect(() => sanitizeQueryParam("filter\uD800\uDC00")).not.toThrow();
    expect(sanitizeQueryParam("filter\uD800\uDC00")).toBe("filter");
  });

  it("enforces the 256-char maximum length", () => {
    const long = "a".repeat(500);
    expect(sanitizeQueryParam(long).length).toBe(256);
  });

  it("returns empty for null/undefined/empty input", () => {
    expect(sanitizeQueryParam(null)).toBe("");
    expect(sanitizeQueryParam(undefined)).toBe("");
    expect(sanitizeQueryParam("")).toBe("");
  });

  it("preserves printable ASCII query values", () => {
    expect(sanitizeQueryParam("status=open&type=invoice")).toBe(
      "status=open&type=invoice"
    );
  });
});

