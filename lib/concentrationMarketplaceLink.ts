/**
 * Concentration alert → marketplace deep link (#944).
 *
 * The alert CTA should open the marketplace on diversification opportunities,
 * so the link filters to every value of the overweight dimension *except* the
 * concentrated one, using the same `riskTiers` / `jurisdictions` params that
 * `app/marketplace/page.tsx` already parses. Debtor concentration has no
 * marketplace filter, and an unknown bucket can't be mapped, so both fall back
 * to the unfiltered marketplace.
 */

import type { ConcentrationAlert } from "@/lib/concentrationRisk";
import { JURISDICTION_PALETTE, RISK_TIER_PALETTE } from "@/lib/portfolioAllocation";
import { sanitizeQueryParam } from "@/lib/security";
import { DEFAULT_FILTERS, toQueryParams, type FilterState } from "@/store/invoiceStore";

/** `source` value tagged on marketplace links opened from a concentration alert. */
export const CONCENTRATION_CTA_SOURCE = "concentration_cta";

// The allocation palettes are keyed by every supported tier / jurisdiction code.
const RISK_TIERS = Object.keys(RISK_TIER_PALETTE);
const JURISDICTIONS = Object.keys(JURISDICTION_PALETTE);

export function marketplacePathForConcentration(
  alert: Pick<ConcentrationAlert, "dimension" | "name">
): string {
  const name = sanitizeQueryParam(alert.name);
  let filters: Partial<FilterState> = {};

  if (alert.dimension === "riskTier" && RISK_TIERS.includes(name)) {
    filters = { riskTiers: RISK_TIERS.filter((tier) => tier !== name) };
  } else if (alert.dimension === "jurisdiction" && JURISDICTIONS.includes(name)) {
    filters = { jurisdictions: JURISDICTIONS.filter((code) => code !== name) };
  }

  const params = toQueryParams(
    { ...DEFAULT_FILTERS, ...filters },
    { sortBy: "apr", sortDir: "desc" }
  );
  params.set("source", CONCENTRATION_CTA_SOURCE);
  return `/marketplace?${params.toString()}`;
}
