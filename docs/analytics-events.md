# Marketplace Analytics Events — Schema Documentation

**Module:** `lib/marketplaceAnalytics.ts`

---

## Overview

Structured, privacy-safe analytics events for the marketplace share → land → fund funnel.  
All events are gated behind the user's analytics preference (opt-out respected) and contain **no PII** — wallet addresses, debtor names, or issuer information are never included.

---

## Privacy Contract

| Field excluded from all payloads | Reason                                     |
|----------------------------------|--------------------------------------------|
| `walletAddress`                  | Stellar G-address is personally linkable   |
| `debtorName`                     | May identify a private individual/company  |
| `issuerName`                     | Same as above                              |
| `invoiceNumber`                  | Directly maps to on-chain data             |

---

## Analytics Preference Gate

Events are suppressed when:

1. `NEXT_PUBLIC_ENABLE_ANALYTICS=false` (build-time kill-switch).
2. `localStorage["kora-analytics-opt-out"] === "true"` (user opt-out).

Default behaviour is opt-in (events fire) unless one of the above signals is present.

---

## Event Catalogue

### `marketplace_land`

Fires when the marketplace page mounts **with at least one deep-link parameter** in the URL.  
Organic visits (no params) do not fire this event — this keeps funnel analysis clean.

**When to use:** Measure how many unique sessions land on the marketplace via a shared filter link.

---

### `marketplace_filter_apply`

Fires when the user applies or changes a filter (categories, jurisdictions, risk tiers, APR range, activeOnly toggle).  
Call **after** the store and URL have been updated so `filter_count` reflects the new state.

**When to use:** Measure filter engagement and identify which filter combinations are most popular.

---

### `marketplace_compare_open`

Fires when the comparison bar becomes visible (≥2 invoices selected for side-by-side comparison).

**When to use:** Track comparison feature adoption and deep-link compare sessions.

---

### `marketplace_fund_cta`

Fires when the **"Fund Invoice"** CTA button is clicked (intent, not confirmation).  
This is a click event — the funding transaction may or may not succeed.

**When to use:** Measure top-of-funnel funding intent. Pair with transaction confirmation events for conversion rate.

---

## Payload Schema

All events share the same payload shape (`MarketplaceAnalyticsPayload`):

```typescript
interface MarketplaceAnalyticsPayload {
  /** The event name (see catalogue above). */
  event: MarketplaceEventName;

  /**
   * "deeplink"          — visit originated from a shared / parameterised URL.
   * "organic"           — user navigated directly or from an unparameterised URL.
   * "concentration_cta" — opened from a concentration-risk alert CTA
   *                       (`?source=concentration_cta`, see below).
   */
  source: "deeplink" | "organic" | "concentration_cta";

  /** Number of active filters at the time of the event (0 = no filters). */
  filter_count: number;

  /** True when the URL contained an invoice_id / token_id parameter. */
  has_invoice_id: boolean;

  /** True when the URL contained a compare parameter. */
  has_compare: boolean;

  /** Active sort value (e.g. "apr_desc"), or null when using the default. */
  sort_by: string | null;

  /** Unix timestamp in milliseconds (Date.now()). */
  timestamp: number;
}
```

### Concentration alert CTA deep link (#944)

`ConcentrationRiskAlerts` links each alert to the marketplace via
`marketplacePathForConcentration` (`lib/concentrationMarketplaceLink.ts`). The
link filters to every value of the overweight dimension *except* the
concentrated one, using the existing filter params:

| Alert dimension | Params                                                         |
|-----------------|----------------------------------------------------------------|
| `riskTier`      | `riskTiers=<all other tiers>&source=concentration_cta`         |
| `jurisdiction`  | `jurisdictions=<all other codes>&source=concentration_cta`     |
| `debtor`, or an unknown bucket | `source=concentration_cta` (unfiltered marketplace) |

Bucket names pass through `sanitizeQueryParam` and must match a supported tier /
jurisdiction code. `marketplace_land` fires with `source: "concentration_cta"`
for these visits, including the unfiltered fallback.

---

## Transport

Events are dispatched via three paths in order:

1. **`window.gtag`** — Google Analytics 4 (if loaded).
2. **`window.plausible`** — Plausible Analytics (if loaded).
3. **`localStorage["kora-marketplace-analytics"]`** — Always buffered locally (capped at 500 entries) for debugging and as a fallback when no analytics SDK is present.

Read buffered events:

```typescript
import { getLocalMarketplaceEvents } from "@/lib/marketplaceAnalytics";

const events = getLocalMarketplaceEvents();
```

---

## Usage

```typescript
import {
  trackMarketplaceLand,
  trackMarketplaceFilterApply,
  trackMarketplaceCompareOpen,
  trackMarketplaceFundCta,
} from "@/lib/marketplaceAnalytics";

// On page mount (reads current URL searchParams)
trackMarketplaceLand(searchParams, activeFiltersCount, sortBy);

// After a filter change
trackMarketplaceFilterApply(searchParams, newFilterCount, sortBy);

// When comparison bar appears
trackMarketplaceCompareOpen(searchParams, filterCount, sortBy);

// When Fund CTA is clicked
trackMarketplaceFundCta(searchParams, filterCount, sortBy);
```

---

## Integration Points

| File                              | Hook                                              |
|-----------------------------------|---------------------------------------------------|
| `app/marketplace/page.tsx`        | `useEffect` on mount (land), filter change effect, comparison toggle, fund CTA click |
| `hooks/useInvoices.ts`            | No change required                                |
| `middleware.ts`                   | No change required                                |
| `lib/installPromptAnalytics.ts`   | Same transport pattern (reference implementation) |

---

## PWA Install Prompt (Issue #708)

`components/pwa/InstallPrompt.tsx` emits these via `lib/installPromptAnalytics.ts`:

| Event                       | Fired when                                        |
|-----------------------------|---------------------------------------------------|
| `install_prompt_shown`      | Banner becomes visible (immediately on 2nd+ visit, after the 30s delay on first visit) |
| `install_prompt_accepted`   | `userChoice` resolves with `accepted`             |
| `install_prompt_dismissed`  | "Not now"/× pressed, or `userChoice` resolves with `dismissed` |

Payload is `{ name, cohort, visitCount, timestamp }` — cohort is derived from the
current route (`sme` / `investor` / `unknown`). No PII is included.
