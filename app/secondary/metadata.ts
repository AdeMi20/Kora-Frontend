/**
 * Secondary market page metadata — Issue #1000
 *
 * Used by `layout.tsx` via `generateMetadata`. Emits title, description,
 * Open Graph and Twitter tags for `/secondary` when the `secondary-market`
 * flag is on. When the flag is off the route only renders a maintenance empty
 * state, so we return a minimal `noindex` head instead of advertising a
 * disabled feature in search results or social previews.
 *
 * The flag is read from env on the server (`lib/serverFeatureFlags.ts`) — never
 * through the client-only hooks in `lib/featureFlags.ts`.
 */

import type { Metadata } from "next";
import { defaultLocale, locales } from "@/i18n/config";
import { isSecondaryMarketEnabledOnServer } from "@/lib/serverFeatureFlags";

const SECONDARY_PATH = "/secondary";

const TITLE = "Secondary Market";
const SOCIAL_TITLE = "Secondary Market | Kora Protocol";
const DESCRIPTION =
  "Buy and sell funded invoice positions peer-to-peer on Stellar Soroban. Exit early or acquire discounted positions in real-world trade finance.";
const SOCIAL_DESCRIPTION =
  "Trade funded invoice positions peer-to-peer. Exit early or buy into real-world trade finance at a discount.";

/** hreflang alternates, matching the root layout's locale path scheme. */
function secondaryLanguageAlternates(): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const locale of locales) {
    alternates[locale] =
      locale === defaultLocale ? SECONDARY_PATH : `/${locale}${SECONDARY_PATH}`;
  }
  return alternates;
}

export function buildSecondaryMetadata(enabled: boolean): Metadata {
  if (!enabled) {
    return {
      title: TITLE,
      robots: { index: false, follow: false },
    };
  }

  return {
    title: TITLE,
    description: DESCRIPTION,
    keywords: [
      "secondary market",
      "invoice positions",
      "P2P trading",
      "trade finance",
      "Stellar",
      "USDC",
    ],
    openGraph: {
      title: SOCIAL_TITLE,
      description: SOCIAL_DESCRIPTION,
      url: SECONDARY_PATH,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "Kora Protocol Secondary Market",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SOCIAL_TITLE,
      description: SOCIAL_DESCRIPTION,
      images: ["/og-image.png"],
    },
    alternates: {
      canonical: SECONDARY_PATH,
      languages: secondaryLanguageAlternates(),
    },
    robots: { index: true, follow: true },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return buildSecondaryMetadata(isSecondaryMarketEnabledOnServer());
}
