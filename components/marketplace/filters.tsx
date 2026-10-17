import React from "react";
import { useTranslations } from "next-intl";

export const JURISDICTIONS = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "EU", name: "European Union", flag: "🇪🇺" },
  { code: "UK", name: "United Kingdom", flag: "🇬🇧" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "OTHER", name: "Other", flag: "🌐" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
];

export const CATEGORIES = [
  { key: "manufacturing", label: "Manufacturing", icon: "🏭" },
  { key: "services", label: "Services", icon: "🛠️" },
  { key: "agriculture", label: "Agriculture", icon: "🌾" },
  { key: "technology", label: "Technology", icon: "💻" },
  { key: "healthcare", label: "Healthcare", icon: "🩺" },
  { key: "retail", label: "Retail", icon: "🛍️" },
  { key: "construction", label: "Construction", icon: "🏗️" },
  { key: "export", label: "Export", icon: "🚢" },
];

export interface PositionFilterState {
  minTenor?: number;
  maxTenor?: number;
  minYield?: number;
  sellerAddress?: string;
  category?: string;
  riskTier?: string;
}

export const TENOR_OPTIONS = [
  { value: "all", label: "All Tenors" },
  { value: "0-30", label: "0 - 30 days", min: 0, max: 30 },
  { value: "31-60", label: "31 - 60 days", min: 31, max: 60 },
  { value: "61-90", label: "61 - 90 days", min: 61, max: 90 },
  { value: "90+", label: "90+ days", min: 91, max: 365 },
];

export const YIELD_OPTIONS = [
  { value: "0", label: "Any Yield" },
  { value: "5", label: "5%+ Yield" },
  { value: "10", label: "10%+ Yield" },
  { value: "15", label: "15%+ Yield" },
];

/**
 * Resolve a localized display label for a jurisdiction code while keeping the
 * stable code as the value used in URLs and filtering logic.
 */
export function useJurisdictionLabel() {
  const t = useTranslations();
  return (code: string) => (t.has(`jurisdictions.${code}`) ? t(`jurisdictions.${code}`) : code);
}

/**
 * Resolve a localized display label for a category key while keeping the
 * stable key as the value used in URLs and filtering logic.
 */
export function useCategoryLabel() {
  const t = useTranslations();
  return (key: string) => (t.has(`categories.${key}`) ? t(`categories.${key}`) : key);
}

/**
 * Resolve a localized display label for a tenor option value while keeping the
 * stable value as the value used in URLs and filtering logic.
 */
export function useTenorLabel() {
  const t = useTranslations();
  return (value: string) => (t.has(`tenors.${value}`) ? t(`tenors.${value}`) : value);
}

/**
 * Resolve a localized display label for a yield option value while keeping the
 * stable value as the value used in URLs and filtering logic.
 */
export function useYieldLabel() {
  const t = useTranslations();
  return (value: string) => (t.has(`yields.${value}`) ? t(`yields.${value}`) : value);
}
