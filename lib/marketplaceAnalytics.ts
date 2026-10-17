/**
 * Marketplace deep-link landing analytics (#563).
 *
 * Privacy-safe event schema for the share → land → fund funnel.
 * No PII: wallet addresses, debtor names, or issuer details are never included.
 *
 * Events fire only when the user has granted analytics consent (checked via
 * `isAnalyticsEnabled()`). The same transport used by installPromptAnalytics
 * is reused: gtag / plausible when present, always buffered to localStorage
 * for local debugging (capped at 500 entries).
 *
 * ## Event catalogue
 *
 * | Event name                   | When                                              |
 * |------------------------------|---------------------------------------------------|
 * | marketplace_land             | Page mounts with at least one active deep-link param |
 * | marketplace_filter_apply     | A filter chip / form control changes the URL      |
 * | marketplace_compare_open     | Comparison bar becomes visible (≥2 items)         |
 * | marketplace_fund_cta         | "Fund Invoice" button clicked (not submitted)     |
 *
 * ## Payload fields (all events)
 *
 * | Field            | Type                    | Notes                                          |
 * |------------------|-------------------------|------------------------------------------------|
 * | event            | string                  | Event name (see above)                        |
 * | source           | "deeplink" \| "organic" \| "concentration_cta" | Shared URL, organic, or a concentration-alert CTA |
 * | filter_count     | number                  | Active filter count at event time             |
 * | has_invoice_id   | boolean                 | URL contained an invoice/token ID             |
 * | has_compare      | boolean                 | URL contained a compare param                 |
 * | sort_by          | string \| null          | Active sort value                             |
 * | timestamp        | number                  | `Date.now()`                                  |
 *
 * Docs: docs/analytics-events.md (created alongside this file)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketplaceEventName =
  | "marketplace_land"
  | "marketplace_filter_apply"
  | "marketplace_compare_open"
  | "marketplace_fund_cta";

export interface MarketplaceAnalyticsPayload {
  event: MarketplaceEventName;
  /**
   * Whether this visit originated from a shared / deep-linked URL, or from a
   * concentration-risk alert CTA (`?source=concentration_cta`, #944).
   */
  source: "deeplink" | "organic" | "concentration_cta";
  /** Number of active filters at the time of the event. */
  filter_count: number;
  /** True when the URL contained an invoice_id / token_id parameter. */
  has_invoice_id: boolean;
  /** True when the URL contained a compare parameter. */
  has_compare: boolean;
  /** Active sort value, or null when default. */
  sort_by: string | null;
  timestamp: number;
}

// ─── Preference gate ──────────────────────────────────────────────────────────

/**
 * Check whether the user has opted-in to analytics.
 * We honour:
 *  1. `NEXT_PUBLIC_ENABLE_ANALYTICS` env flag (false → always off)
 *  2. The `kora-analytics-opt-out` localStorage key (set → off)
 *
 * Defaults to **opt-in** (true) when neither signal is present — matches the
 * existing installPromptAnalytics behaviour which always fires unless blocked.
 */
export function isAnalyticsEnabled(): boolean {
  // Build-time kill-switch (e.g. staging environments that don't want noise)
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "false"
  ) {
    return false;
  }
  // User opt-out stored in localStorage
  try {
    return localStorage.getItem("kora-analytics-opt-out") !== "true";
  } catch {
    return true;
  }
}

// ─── Deep-link detection ─────────────────────────────────────────────────────

const DEEPLINK_PARAMS = new Set([
  "categories",
  "jurisdictions",
  "riskTiers",
  "minApr",
  "maxApr",
  "activeOnly",
  "sortBy",
  "q",
  "invoice_id",
  "compare",
]);

/**
 * Returns `true` when the given URLSearchParams object contains at least one
 * deep-link filter parameter — distinguishing a freshly shared URL from an
 * unparameterised organic visit.
 */
export function isDeepLink(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (DEEPLINK_PARAMS.has(key)) return true;
  }
  return false;
}

function landingSource(params: URLSearchParams): MarketplaceAnalyticsPayload["source"] {
  if (params.get("source") === "concentration_cta") return "concentration_cta";
  return isDeepLink(params) ? "deeplink" : "organic";
}

// ─── Transport ────────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "kora-marketplace-analytics";
const MAX_STORED_EVENTS = 500;

function dispatch(payload: MarketplaceAnalyticsPayload): void {
  if (!isAnalyticsEnabled()) return;

  try {
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
      plausible?: (...args: unknown[]) => void;
    };

    if (typeof w.gtag === "function") {
      w.gtag("event", payload.event, {
        source: payload.source,
        filter_count: payload.filter_count,
        has_invoice_id: payload.has_invoice_id,
        has_compare: payload.has_compare,
        sort_by: payload.sort_by,
      });
    }

    if (typeof w.plausible === "function") {
      w.plausible(payload.event, {
        props: {
          source: payload.source,
          filter_count: payload.filter_count,
          has_invoice_id: payload.has_invoice_id,
          has_compare: payload.has_compare,
          sort_by: payload.sort_by ?? "default",
        },
      });
    }

    // Always buffer locally so metrics aren't lost when no SDK is loaded.
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const events: MarketplaceAnalyticsPayload[] = raw ? JSON.parse(raw) : [];
    events.push(payload);
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify(events.slice(-MAX_STORED_EVENTS))
    );
  } catch {
    // Analytics must never break the marketplace.
  }
}

// ─── Event builders ───────────────────────────────────────────────────────────

function buildPayload(
  event: MarketplaceEventName,
  params: URLSearchParams,
  filterCount: number,
  sortBy?: string | null
): MarketplaceAnalyticsPayload {
  return {
    event,
    source: landingSource(params),
    filter_count: filterCount,
    has_invoice_id: params.has("invoice_id"),
    has_compare: params.has("compare"),
    sort_by: sortBy ?? params.get("sortBy"),
    timestamp: Date.now(),
  };
}

/**
 * Fire when the marketplace page mounts.
 * Only fires when the URL is a deep-link (has at least one filter param)
 * so organic visits don't inflate the funnel.
 */
export function trackMarketplaceLand(
  params: URLSearchParams,
  filterCount: number,
  sortBy?: string | null
): void {
  if (landingSource(params) === "organic") return;
  dispatch(buildPayload("marketplace_land", params, filterCount, sortBy));
}

/**
 * Fire when the user applies or removes a filter.
 * Call this after the store/URL update so `filterCount` is the new count.
 */
export function trackMarketplaceFilterApply(
  params: URLSearchParams,
  filterCount: number,
  sortBy?: string | null
): void {
  dispatch(buildPayload("marketplace_filter_apply", params, filterCount, sortBy));
}

/**
 * Fire when the comparison bar becomes visible (≥2 invoices selected).
 */
export function trackMarketplaceCompareOpen(
  params: URLSearchParams,
  filterCount: number,
  sortBy?: string | null
): void {
  dispatch(buildPayload("marketplace_compare_open", params, filterCount, sortBy));
}

/**
 * Fire when the "Fund Invoice" CTA is clicked on the marketplace page or
 * the detail page's fund button.
 */
export function trackMarketplaceFundCta(
  params: URLSearchParams,
  filterCount: number,
  sortBy?: string | null
): void {
  dispatch(buildPayload("marketplace_fund_cta", params, filterCount, sortBy));
}

// ─── Debug helper ─────────────────────────────────────────────────────────────

/** Read locally-buffered events back out for a debug/analytics panel. */
export function getLocalMarketplaceEvents(): MarketplaceAnalyticsPayload[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
