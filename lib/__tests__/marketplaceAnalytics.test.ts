/**
 * Unit tests for lib/marketplaceAnalytics.ts (#563)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isDeepLink,
  isAnalyticsEnabled,
  trackMarketplaceLand,
  trackMarketplaceFilterApply,
  trackMarketplaceCompareOpen,
  trackMarketplaceFundCta,
  getLocalMarketplaceEvents,
} from "../marketplaceAnalytics";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(obj: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(obj);
}

// ─── isDeepLink ───────────────────────────────────────────────────────────────

describe("isDeepLink", () => {
  it("returns false for empty params", () => {
    expect(isDeepLink(makeParams())).toBe(false);
  });

  it("returns true when categories param is present", () => {
    expect(isDeepLink(makeParams({ categories: "technology" }))).toBe(true);
  });

  it("returns true when riskTiers param is present", () => {
    expect(isDeepLink(makeParams({ riskTiers: "AAA,AA" }))).toBe(true);
  });

  it("returns true when invoice_id param is present", () => {
    expect(isDeepLink(makeParams({ invoice_id: "42" }))).toBe(true);
  });

  it("returns true when compare param is present", () => {
    expect(isDeepLink(makeParams({ compare: "1,2" }))).toBe(true);
  });

  it("returns false for non-deeplink params", () => {
    expect(isDeepLink(makeParams({ page: "2", foo: "bar" }))).toBe(false);
  });
});

// ─── isAnalyticsEnabled ───────────────────────────────────────────────────────

describe("isAnalyticsEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns true by default (no opt-out stored)", () => {
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("returns false when opt-out key is set", () => {
    localStorage.setItem("kora-analytics-opt-out", "true");
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("returns true when opt-out key is not 'true'", () => {
    localStorage.setItem("kora-analytics-opt-out", "false");
    expect(isAnalyticsEnabled()).toBe(true);
  });
});

// ─── Event builders + local storage buffering ─────────────────────────────────

describe("marketplace analytics events", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("trackMarketplaceLand fires for deep-link visits", () => {
    const params = makeParams({ categories: "technology", sortBy: "apr_desc" });
    trackMarketplaceLand(params, 1, "apr_desc");

    const events = getLocalMarketplaceEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("marketplace_land");
    expect(events[0].source).toBe("deeplink");
    expect(events[0].filter_count).toBe(1);
    expect(events[0].sort_by).toBe("apr_desc");
  });

  it("trackMarketplaceLand does NOT fire for organic visits", () => {
    trackMarketplaceLand(makeParams(), 0, null);
    expect(getLocalMarketplaceEvents()).toHaveLength(0);
  });

  it("trackMarketplaceLand tags concentration alert CTA visits (#944)", () => {
    trackMarketplaceLand(
      makeParams({ riskTiers: "AAA,AA", source: "concentration_cta" }),
      1,
      null
    );
    const events = getLocalMarketplaceEvents();
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("concentration_cta");
  });

  it("trackMarketplaceLand fires for an unfiltered concentration CTA fallback", () => {
    trackMarketplaceLand(makeParams({ source: "concentration_cta" }), 0, null);
    const events = getLocalMarketplaceEvents();
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("concentration_cta");
  });

  it("trackMarketplaceFilterApply fires regardless of source", () => {
    trackMarketplaceFilterApply(makeParams(), 2, "amount_desc");
    const events = getLocalMarketplaceEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("marketplace_filter_apply");
    expect(events[0].filter_count).toBe(2);
    expect(events[0].source).toBe("organic");
  });

  it("trackMarketplaceCompareOpen sets has_compare from params", () => {
    trackMarketplaceCompareOpen(makeParams({ compare: "1,2" }), 0);
    const events = getLocalMarketplaceEvents();
    expect(events[0].event).toBe("marketplace_compare_open");
    expect(events[0].has_compare).toBe(true);
  });

  it("trackMarketplaceFundCta fires with invoice_id when present", () => {
    trackMarketplaceFundCta(makeParams({ invoice_id: "99" }), 0);
    const events = getLocalMarketplaceEvents();
    expect(events[0].event).toBe("marketplace_fund_cta");
    expect(events[0].has_invoice_id).toBe(true);
  });

  it("events are capped at 500", () => {
    const params = makeParams({ categories: "tech" });
    for (let i = 0; i < 510; i++) {
      trackMarketplaceFilterApply(params, 1);
    }
    expect(getLocalMarketplaceEvents().length).toBeLessThanOrEqual(500);
  });

  it("events are NOT stored when analytics is opted out", () => {
    localStorage.setItem("kora-analytics-opt-out", "true");
    trackMarketplaceFilterApply(makeParams({ categories: "tech" }), 1);
    expect(getLocalMarketplaceEvents()).toHaveLength(0);
  });

  it("payload contains no PII fields", () => {
    trackMarketplaceFilterApply(makeParams({ categories: "tech" }), 1);
    const event = getLocalMarketplaceEvents()[0];
    // Ensure no wallet address, debtor name, issuer name fields
    const keys = Object.keys(event);
    expect(keys).not.toContain("walletAddress");
    expect(keys).not.toContain("debtorName");
    expect(keys).not.toContain("issuerName");
    expect(keys).not.toContain("address");
  });
});
