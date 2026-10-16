import { describe, it, expect } from "vitest";
import {
  getInvalidationKeys,
  getInvoiceDataSource,
  queryInvalidationRules,
  queryKeyHierarchy,
  queryKeys,
} from "@/lib/queryKeys";

describe("queryKeys invoice detail source namespacing", () => {
  it("defaults to live when mock flag is unset", () => {
    const original = process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA;
    delete process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA;

    expect(getInvoiceDataSource()).toBe("live");
    expect(queryKeys.invoices.detail("abc")).toEqual([
      "invoices",
      "detail",
      "live",
      "abc",
    ]);

    process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA = original;
  });

  it("namespaces mock detail keys separately from live", () => {
    expect(queryKeys.invoices.detail("abc", "mock")).toEqual([
      "invoices",
      "detail",
      "mock",
      "abc",
    ]);
    expect(queryKeys.invoices.detail("abc", "live")).toEqual([
      "invoices",
      "detail",
      "live",
      "abc",
    ]);
    expect(queryKeys.invoices.detail("abc", "mock")).not.toEqual(
      queryKeys.invoices.detail("abc", "live")
    );
  });
});

describe("queryKeys hierarchy", () => {
  it("documents stable invoice key prefixes", () => {
    expect(queryKeyHierarchy.invoices.root).toEqual(["invoices"]);
    expect(queryKeyHierarchy.invoices.listPrefix).toEqual(["invoices", "list"]);
    expect(queryKeyHierarchy.invoices.infinitePrefix).toEqual(["invoices", "infinite"]);
    expect(queryKeyHierarchy.invoices.detailPrefix).toEqual(["invoices", "detail"]);
    expect(queryKeyHierarchy.invoices.positionsPrefix).toEqual(["invoices", "positions"]);
  });

  it("nests investor positions under the positions prefix so invalidations reach usePositions", () => {
    const key = queryKeys.invoices.positions("GABC", "live");
    expect(key).toEqual(["invoices", "positions", "live", "GABC"]);
    expect(key.slice(0, 2)).toEqual(queryKeyHierarchy.invoices.positionsPrefix);
  });

  it("sorts batch invoice ids so equivalent batches share one key", () => {
    expect(queryKeys.invoices.batch(["9", "1", "5"])).toEqual([
      "invoices",
      "batch",
      "1,5,9",
    ]);
  });

  it("keeps account keys nested below the wallet address", () => {
    expect(queryKeys.account.all("GABC")).toEqual(["account", "GABC"]);
    expect(queryKeys.account.usdcBalance("GABC")).toEqual(["account", "GABC", "usdc"]);
    expect(queryKeys.account.transactions("GABC", 25, "next")).toEqual([
      "account",
      "GABC",
      "transactions",
      25,
      "next",
    ]);
  });
});

describe("query invalidation rules", () => {
  it("covers every documented invalidation event", () => {
    expect(Object.keys(queryInvalidationRules).sort()).toEqual([
      "invoice_cancelled",
      "invoice_funded",
      "invoice_repaid",
      "kyc_status_changed",
      "mint_invoice",
      "usdc_balance_changed",
      "wallet_connected",
      "wallet_disconnected",
    ]);
  });

  it("invalidates the KYC status and the invoice caches the funding gate reads", () => {
    // A KYC transition opens or closes the funding gate, so the lists and
    // details that render it have to re-evaluate alongside the status itself.
    expect(getInvalidationKeys("kyc_status_changed", { address: "GABC" })).toEqual([
      queryKeys.kyc.status("GABC"),
      queryKeys.invoices.all,
    ]);
  });

  it("falls back to the KYC root when no address is supplied", () => {
    expect(getInvalidationKeys("kyc_status_changed")).toEqual([
      queryKeys.kyc.all,
      queryKeys.invoices.all,
    ]);
  });

  it("invalidates invoice detail and broad invoice caches when funding changes", () => {
    expect(getInvalidationKeys("invoice_funded", { tokenId: "42" })).toEqual([
      queryKeys.invoices.detail("42"),
      queryKeys.invoices.all,
    ]);
  });

  it("invalidates positions after repayment", () => {
    expect(getInvalidationKeys("invoice_repaid", { tokenId: "42" })).toEqual([
      queryKeys.invoices.detail("42"),
      queryKeys.invoices.all,
      queryKeyHierarchy.invoices.positionsPrefix,
    ]);
  });

  it("omits concrete keys when required context is missing", () => {
    expect(getInvalidationKeys("wallet_connected")).toEqual([]);
    expect(getInvalidationKeys("usdc_balance_changed")).toEqual([]);
  });

  it("invalidates the USDC balance key for balance changes", () => {
    expect(getInvalidationKeys("usdc_balance_changed", { address: "GABC" })).toEqual([
      queryKeys.account.usdcBalance("GABC"),
    ]);
  });
});
