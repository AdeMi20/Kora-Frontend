/**
 * Server-side feature flag reads — Issues #1000 / #1002
 *
 * `lib/featureFlags.ts` imports React (`useSyncExternalStore`) for its hooks,
 * so it must not be pulled into server layouts or route handlers. These
 * helpers read the same `NEXT_PUBLIC_ENABLE_*` env vars as `FLAG_ENV_MAP`
 * with the same semantics (only the literal string `"true"` enables a flag).
 *
 * Runtime overrides from the dev Feature Flags panel live in localStorage and
 * are never visible here — server output (metadata, sitemap) follows env only.
 */

/** Mirrors `FLAG_ENV_MAP["secondary-market"]` in `lib/featureFlags.ts`. */
export function isSecondaryMarketEnabledOnServer(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SECONDARY_MARKET === "true";
}
