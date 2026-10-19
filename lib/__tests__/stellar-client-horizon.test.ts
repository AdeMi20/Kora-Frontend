/**
 * Horizon error shaping + balance fetch failures — Issue #1006
 *
 * `normaliseHorizonError` is the single place Horizon failures become the
 * typed errors hooks render (`AccountNotFoundError`, `HorizonRateLimitError`,
 * `HorizonNetworkError`). These tests pin that mapping and the
 * `getAccountBalances` edge cases without touching a live Horizon: the
 * `horizon.loadAccount` singleton method is replaced with a spy.
 *
 * `hooks/__tests__/useAccountBalance.test.tsx` mocks the query hook entirely,
 * so it never reaches this layer — the two suites do not overlap.
 *
 * Covers:
 *  1. normaliseHorizonError — 404 → AccountNotFoundError (with/without address)
 *  2. normaliseHorizonError — 429 → HorizonRateLimitError
 *  3. normaliseHorizonError — 5xx / HTML error page → HorizonNetworkError("HTTP …")
 *  4. normaliseHorizonError — offline / no response → HorizonNetworkError
 *  5. normaliseHorizonError — non-Error throws → HorizonNetworkError
 *  6. getAccountBalances — success, empty testnet account, reserve maths
 *  7. getAccountBalances — each failure class propagates the mapped error
 *  8. getAccountBalances — malformed 200 response → HorizonNetworkError
 *  9. getUSDCBalance / checkAccountExists — share the same mapping
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// ── Mock env before importing the module under test ───────────────────────────

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  },
}));

import {
  AccountNotFoundError,
  HorizonNetworkError,
  HorizonRateLimitError,
  USDC_ASSET,
  checkAccountExists,
  getAccountBalances,
  getUSDCBalance,
  horizon,
  normaliseHorizonError,
} from "@/lib/stellar/client";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADDRESS = "GBQXFQ2PVCFP2LOJ3XPMBLM5R2LSCVJKGHGXAWWVQCLDWKZVKKPFDANJ";
const USDC_ISSUER = USDC_ASSET.getIssuer();
const OTHER_ISSUER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

/** Shape the Horizon SDK uses for HTTP failures: an Error with `response`. */
function httpError(status: number, message = `Request failed with status code ${status}`, data?: unknown) {
  return Object.assign(new Error(message), {
    response: { status, statusText: "", data },
  });
}

const HTML_ERROR_PAGE =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";

type Balance = Record<string, string>;

function accountResponse(balances: Balance[], subentryCount = 0) {
  return { id: ADDRESS, subentry_count: subentryCount, balances };
}

const native = (balance: string): Balance => ({ asset_type: "native", balance });
const credit = (code: string, issuer: string, balance: string): Balance => ({
  asset_type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
  asset_code: code,
  asset_issuer: issuer,
  balance,
});

/** Run `fn` and return what it threw (fails the test if it did not throw). */
function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw");
}

// ── normaliseHorizonError ─────────────────────────────────────────────────────

describe("normaliseHorizonError", () => {
  it("maps 404 to AccountNotFoundError carrying the address", () => {
    const err = caught(() => normaliseHorizonError(httpError(404, "Not Found"), ADDRESS));
    expect(err).toBeInstanceOf(AccountNotFoundError);
    expect(err).toMatchObject({
      name: "AccountNotFoundError",
      message: `Account not found: ${ADDRESS}`,
    });
  });

  it("falls back to 'unknown' when a 404 has no address", () => {
    const err = caught(() => normaliseHorizonError(httpError(404)));
    expect(err).toBeInstanceOf(AccountNotFoundError);
    expect((err as Error).message).toBe("Account not found: unknown");
  });

  it("maps 429 to HorizonRateLimitError with a user-facing message", () => {
    const err = caught(() => normaliseHorizonError(httpError(429, "Too Many Requests"), ADDRESS));
    expect(err).toBeInstanceOf(HorizonRateLimitError);
    expect(err).toMatchObject({
      name: "HorizonRateLimitError",
      message: "Horizon rate limit exceeded. Please try again shortly.",
    });
  });

  it.each([
    [400, "Bad Request"],
    [500, "Internal Server Error"],
    [503, "Service Unavailable"],
  ])("maps HTTP %i to HorizonNetworkError with the status", (status, message) => {
    const err = caught(() => normaliseHorizonError(httpError(status, message), ADDRESS));
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).name).toBe("HorizonNetworkError");
    expect((err as Error).message).toBe(`Horizon network error: HTTP ${status}: ${message}`);
  });

  it("does not leak an HTML error page body into the message", () => {
    const err = caught(() =>
      normaliseHorizonError(httpError(502, "Bad Gateway", HTML_ERROR_PAGE), ADDRESS),
    );
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).message).toBe("Horizon network error: HTTP 502: Bad Gateway");
    expect((err as Error).message).not.toContain("<html>");
  });

  it("maps an offline fetch failure (no response) to HorizonNetworkError", () => {
    const err = caught(() => normaliseHorizonError(new TypeError("Failed to fetch"), ADDRESS));
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).message).toBe("Horizon network error: TypeError: Failed to fetch");
  });

  it("maps a request timeout without a response to HorizonNetworkError", () => {
    const timeout = Object.assign(new Error("timeout of 60000ms exceeded"), { code: "ECONNABORTED" });
    const err = caught(() => normaliseHorizonError(timeout, ADDRESS));
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).message).toContain("timeout of 60000ms exceeded");
  });

  it.each([
    ["a string", "socket hang up", "Horizon network error: socket hang up"],
    ["undefined", undefined, "Horizon network error: undefined"],
    ["null", null, "Horizon network error: null"],
  ])("maps a non-Error throw (%s) to HorizonNetworkError", (_label, thrown, message) => {
    const err = caught(() => normaliseHorizonError(thrown, ADDRESS));
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).message).toBe(message);
  });

  it("treats an Error whose response has no status as a network error", () => {
    const err = caught(() =>
      normaliseHorizonError(Object.assign(new Error("Network Error"), { response: {} }), ADDRESS),
    );
    expect(err).toBeInstanceOf(HorizonNetworkError);
    expect((err as Error).message).toBe("Horizon network error: Error: Network Error");
  });
});

// ── Public helpers backed by horizon.loadAccount ──────────────────────────────

describe("Horizon-backed account helpers", () => {
  let loadAccount: MockInstance;

  beforeEach(() => {
    loadAccount = vi.spyOn(horizon, "loadAccount");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getAccountBalances", () => {
    it("parses XLM (minus reserve), USDC and other assets", async () => {
      loadAccount.mockResolvedValue(
        accountResponse(
          [
            native("100.0000000"),
            credit("USDC", USDC_ISSUER, "250.5000000"),
            credit("EURC", OTHER_ISSUER, "10.0000000"),
          ],
          2,
        ),
      );

      await expect(getAccountBalances(ADDRESS)).resolves.toEqual({
        // reserve = (2 + 2 subentries) * 0.5 = 2 XLM
        xlm: "98.0000000",
        usdc: "250.5000000",
        otherAssets: [{ code: "EURC", issuer: OTHER_ISSUER, balance: "10.0000000" }],
      });
      expect(loadAccount).toHaveBeenCalledWith(ADDRESS);
    });

    it("returns zeroed balances for an empty (minimum-reserve) testnet account", async () => {
      loadAccount.mockResolvedValue(accountResponse([native("1.0000000")]));

      await expect(getAccountBalances(ADDRESS)).resolves.toEqual({
        xlm: "0.0000000",
        usdc: "0",
        otherAssets: [],
      });
    });

    it("never reports negative XLM when the balance is below the reserve", async () => {
      loadAccount.mockResolvedValue(accountResponse([native("0.5000000")], 3));
      const balances = await getAccountBalances(ADDRESS);
      expect(balances.xlm).toBe("0.0000000");
    });

    it("treats USDC from a non-canonical issuer as an other asset", async () => {
      loadAccount.mockResolvedValue(
        accountResponse([native("5.0000000"), credit("USDC", OTHER_ISSUER, "99.0000000")]),
      );

      const balances = await getAccountBalances(ADDRESS);
      expect(balances.usdc).toBe("0");
      expect(balances.otherAssets).toEqual([
        { code: "USDC", issuer: OTHER_ISSUER, balance: "99.0000000" },
      ]);
    });

    it("ignores liquidity pool shares", async () => {
      loadAccount.mockResolvedValue(
        accountResponse([
          native("5.0000000"),
          { asset_type: "liquidity_pool_shares", liquidity_pool_id: "abc", balance: "1.0000000" },
        ]),
      );

      const balances = await getAccountBalances(ADDRESS);
      expect(balances.otherAssets).toEqual([]);
    });

    it("throws AccountNotFoundError for an unfunded account (404)", async () => {
      loadAccount.mockRejectedValue(httpError(404, "Not Found"));
      await expect(getAccountBalances(ADDRESS)).rejects.toBeInstanceOf(AccountNotFoundError);
      await expect(getAccountBalances(ADDRESS)).rejects.toThrow(`Account not found: ${ADDRESS}`);
    });

    it("throws HorizonRateLimitError on 429", async () => {
      loadAccount.mockRejectedValue(httpError(429));
      await expect(getAccountBalances(ADDRESS)).rejects.toBeInstanceOf(HorizonRateLimitError);
    });

    it("throws HorizonNetworkError when Horizon returns an HTML error page", async () => {
      loadAccount.mockRejectedValue(httpError(502, "Bad Gateway", HTML_ERROR_PAGE));
      await expect(getAccountBalances(ADDRESS)).rejects.toThrow(
        new HorizonNetworkError("HTTP 502: Bad Gateway"),
      );
    });

    it("throws HorizonNetworkError when the network is offline", async () => {
      loadAccount.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(getAccountBalances(ADDRESS)).rejects.toBeInstanceOf(HorizonNetworkError);
    });

    it.each([
      ["an empty body", undefined],
      ["null", null],
      ["an object without balances", { id: ADDRESS }],
      ["a non-array balances field", { id: ADDRESS, balances: "oops" }],
      ["an HTML string served with 200", HTML_ERROR_PAGE],
    ])("throws HorizonNetworkError for a malformed 200 response (%s)", async (_label, body) => {
      loadAccount.mockResolvedValue(body);
      await expect(getAccountBalances(ADDRESS)).rejects.toThrow(
        new HorizonNetworkError("malformed account response"),
      );
    });
  });

  describe("getUSDCBalance", () => {
    it("returns the USDC balance as a number", async () => {
      loadAccount.mockResolvedValue(
        accountResponse([native("5.0000000"), credit("USDC", USDC_ISSUER, "42.1250000")]),
      );
      await expect(getUSDCBalance(ADDRESS)).resolves.toBe(42.125);
    });

    it("returns 0 when there is no USDC trustline", async () => {
      loadAccount.mockResolvedValue(accountResponse([native("5.0000000")]));
      await expect(getUSDCBalance(ADDRESS)).resolves.toBe(0);
    });

    it("propagates the normalised error", async () => {
      loadAccount.mockRejectedValue(httpError(404));
      await expect(getUSDCBalance(ADDRESS)).rejects.toBeInstanceOf(AccountNotFoundError);
    });
  });

  describe("checkAccountExists", () => {
    it("returns true when the account loads", async () => {
      loadAccount.mockResolvedValue(accountResponse([native("5.0000000")]));
      await expect(checkAccountExists(ADDRESS)).resolves.toBe(true);
    });

    it("returns false (not an error) on 404", async () => {
      loadAccount.mockRejectedValue(httpError(404));
      await expect(checkAccountExists(ADDRESS)).resolves.toBe(false);
    });

    it("re-throws 429 as HorizonRateLimitError", async () => {
      loadAccount.mockRejectedValue(httpError(429));
      await expect(checkAccountExists(ADDRESS)).rejects.toBeInstanceOf(HorizonRateLimitError);
    });

    it("re-throws offline failures as HorizonNetworkError", async () => {
      loadAccount.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(checkAccountExists(ADDRESS)).rejects.toBeInstanceOf(HorizonNetworkError);
    });
  });
});
