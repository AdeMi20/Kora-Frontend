/**
 * Unit tests for lib/concentrationMarketplaceLink.ts (#944)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ENABLE_MOCK_DATA: true },
}));

import {
  CONCENTRATION_CTA_SOURCE,
  marketplacePathForConcentration,
} from "../concentrationMarketplaceLink";
import { fromQueryParams } from "@/store/invoiceStore";

function parse(href: string) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  return { path, params, filters: fromQueryParams(params).filters };
}

describe("marketplacePathForConcentration", () => {
  it("filters to every other risk tier for a risk-tier alert", () => {
    const { path, params, filters } = parse(
      marketplacePathForConcentration({ dimension: "riskTier", name: "BBB" })
    );
    expect(path).toBe("/marketplace");
    expect(filters.riskTiers).toEqual(["AAA", "AA", "A", "BB", "B", "CCC"]);
    expect(filters.jurisdictions).toEqual([]);
    expect(params.get("source")).toBe(CONCENTRATION_CTA_SOURCE);
  });

  it("filters to every other jurisdiction for a jurisdiction alert", () => {
    const { filters } = parse(
      marketplacePathForConcentration({ dimension: "jurisdiction", name: "NG" })
    );
    expect(filters.jurisdictions).not.toContain("NG");
    expect(filters.jurisdictions).toContain("US");
    expect(filters.riskTiers).toEqual([]);
  });

  it("does not add comparison or sort params", () => {
    const { params } = parse(
      marketplacePathForConcentration({ dimension: "riskTier", name: "A" })
    );
    expect(params.has("compare")).toBe(false);
    expect(params.has("sortBy")).toBe(false);
  });

  it.each([
    { dimension: "debtor" as const, name: "Acme Corp" },
    { dimension: "riskTier" as const, name: "Unknown" },
    { dimension: "jurisdiction" as const, name: "XX" },
    { dimension: "jurisdiction" as const, name: "NG\u0000<script>" },
    { dimension: "bogus" as never, name: "AAA" },
  ])("falls back to the unfiltered marketplace for %o", (alert) => {
    expect(marketplacePathForConcentration(alert)).toBe(
      `/marketplace?source=${CONCENTRATION_CTA_SOURCE}`
    );
  });
});
