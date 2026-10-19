# Feature Flags

Kora gates optional/experimental surfaces behind a centralised, type-safe
feature-flag system ([`lib/featureFlags.ts`](../lib/featureFlags.ts), issue
#308). Every flag is backed by a `NEXT_PUBLIC_ENABLE_*` environment variable,
so the same build can be configured per deployment by env alone.

## Reading a flag in code

```ts
import { isEnabled, useFeatureFlag } from "@/lib/featureFlags";

if (isEnabled("secondary-market")) { ... } // non-component code

const enabled = useFeatureFlag("comparison"); // inside a component (reactive)
```

## Flag reference

Source of truth: `FLAG_ENV_MAP` in `lib/featureFlags.ts`. Env values are
compared against the literal string `"true"` — anything else is off.

| Flag                        | Env var                                        | Purpose                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock-data`                 | `NEXT_PUBLIC_ENABLE_MOCK_DATA`                 | Use static mock fixtures instead of live Soroban RPC calls. Also selects the app's **network mode** (`mock` vs `live`), which drives TanStack Query tuning via `getNetworkMode()` / `QUERY_TUNING` (#436). |
| `devtools`                  | `NEXT_PUBLIC_ENABLE_DEVTOOLS`                  | Show React Query devtools and engineering-only diagnostics.                                                                                                                                                |
| `comparison`                | `NEXT_PUBLIC_ENABLE_COMPARISON`                | Invoice comparison bar and table in the marketplace.                                                                                                                                                       |
| `onboarding-tour`           | `NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR`           | Guided onboarding tour overlay for new users. **Default-inverted** — see below.                                                                                                                            |
| `batch-actions`             | `NEXT_PUBLIC_ENABLE_BATCH_ACTIONS`             | Batch cancel/repay toolbar in the SME dashboard.                                                                                                                                                           |
| `kyb-mint-gate`             | `NEXT_PUBLIC_ENABLE_KYB_MINT_GATE`             | Gate invoice minting behind KYB/KYC business verification in the mint wizard.                                                                                                                              |
| `secondary-market`          | `NEXT_PUBLIC_ENABLE_SECONDARY_MARKET`          | Secondary market P2P position-listing route (`/secondary`) — hides the navbar link and shows a maintenance empty state when off.                                                                           |
| `category-taxonomy-preview` | `NEXT_PUBLIC_ENABLE_CATEGORY_TAXONOMY_PREVIEW` | Developer preview panel for the category taxonomy in the marketplace filters.                                                                                                                              |

### Defaults

Two layers of default apply:

1. **Intrinsic (env unset).** Every flag defaults to `false` except
   `onboarding-tour`, whose guard is `val !== "false"` — it is **on unless the
   env var is literally `"false"`** (`lib/featureFlags.ts:70`).
2. **`.env.example`.** The checked-in example sets recommended dev values:
   `mock-data`, `devtools`, `comparison`, `batch-actions`, and
   `secondary-market` are `true`; `onboarding-tour` and `kyb-mint-gate` are
   `false`; `category-taxonomy-preview` is not listed (off). Copying
   `.env.example` to `.env.local` reproduces the standard dev setup.

## Overriding locally

### 1. Env var (`.env.local`)

Add or edit the variable in `.env.local`:

```bash
NEXT_PUBLIC_ENABLE_SECONDARY_MARKET=true
NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR=false
```

Because `NEXT_PUBLIC_*` values are inlined into the client bundle at
build/startup time, **restart `npm run dev`** after changing them. `.env.local`
takes precedence over `.env` and `.env.example`.

### 2. Runtime override panel (development only)

During development, the **Feature Flags** panel (bottom-left) toggles flags
without a restart. It is rendered by
[`components/dev/FeatureFlagPanel.tsx`](../components/dev/FeatureFlagPanel.tsx)
whenever `NODE_ENV === "development"` or `NEXT_PUBLIC_ENABLE_DEVTOOLS === "true"`.

- Overrides are stored under the localStorage key `kora:feature-flag-overrides`
  and take precedence over env values.
- The reset button clears all overrides (back to env values); toggling
  `mock-data` also invalidates active invoice queries.
- Runtime overrides are **ignored in production builds**
  (`canUseRuntimeOverrides()` gates on `NODE_ENV !== "production"`), so they are
  safe for local iteration only.

## Where flags are consumed

| Flag                        | Consumers                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `mock-data`                 | `getNetworkMode()` / `QUERY_TUNING` (`lib/featureFlags.ts`), invoice data sources (`lib/queryKeys.ts`)                              |
| `devtools`                  | `app/providers.tsx` (React Query devtools)                                                                                          |
| `comparison`                | `components/marketplace/ComparisonBar.tsx`, `ComparisonTable.tsx`, `components/invoice/InvoiceCard.tsx`, `app/marketplace/page.tsx` |
| `onboarding-tour`           | `components/onboarding/OnboardingTour.tsx`, `app/providers.tsx`                                                                     |
| `batch-actions`             | `app/dashboard/sme/page.tsx`                                                                                                        |
| `kyb-mint-gate`             | `app/invoice/create/page.tsx`                                                                                                       |
| `secondary-market`          | `components/layout/Navbar.tsx`, `app/secondary/page.tsx`, `app/secondary/metadata.ts` (server), `app/sitemap.xml/route.ts` (server) |
| `category-taxonomy-preview` | `components/marketplace/CategoryTaxonomyPreview.tsx`                                                                                |

## Server-side flag reads (SEO)

`lib/featureFlags.ts` imports React hooks, so server layouts and route handlers
must not import it. Server code reads flags through
[`lib/serverFeatureFlags.ts`](../lib/serverFeatureFlags.ts), which mirrors the
`FLAG_ENV_MAP` env var and its `"true"`-only semantics. The runtime override
panel (localStorage) is **not** visible on the server — SEO output follows the
deployment env only, so a flag enabled in staging env advertises the route in
staging only.

### `secondary-market` (#1000, #1002)

| Surface                                             | Flag on                                                                                  | Flag off                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `/secondary` head (`app/secondary/metadata.ts`)     | Title, description, Open Graph + Twitter card, canonical + hreflang, `index, follow`      | Title only, `noindex, nofollow`, no OG/Twitter tags  |
| `/sitemap.xml` (`app/sitemap.xml/route.ts`)         | Emits `/secondary` with `changefreq: hourly`, `priority: 0.7`                            | `/secondary` omitted (avoids crawls of a disabled route) |

The sitemap evaluates the flag on every request (it is a dynamic route handler
with a 1h `Cache-Control`), so flipping the env and redeploying/restarting is
enough — no manual sitemap edits per release.

## Adding a new flag

1. Add the flag to the `FeatureFlag` union, `FEATURE_FLAGS`, and `FLAG_ENV_MAP`
   in `lib/featureFlags.ts`.
2. Add a description in `FLAG_DESCRIPTIONS` (`components/dev/FeatureFlagPanel.tsx`)
   so the runtime panel labels it.
3. Add the matching `NEXT_PUBLIC_ENABLE_*` row to `.env.example`, and update
   the table above.
