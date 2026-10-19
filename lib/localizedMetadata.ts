/**
 * Locale-aware route metadata helpers.
 *
 * Server layouts call `generateLocalizedMetadata` from their `generateMetadata`
 * export so titles, descriptions and Open Graph tags follow the active locale
 * resolved by middleware (`x-kora-locale`), the same source the root layout
 * uses for `lang`/`dir`.
 *
 * Closes #1004
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import { defaultLocale, locales, type Locale } from "@/i18n/config";

/** Header set by middleware from the locale cookie / Accept-Language. */
export const LOCALE_HEADER = "x-kora-locale";

/**
 * Map locale code to OpenGraph locale format.
 */
export function localeToOgLocale(locale: Locale): string {
  const localeMap: Record<Locale, string> = {
    en: "en_US",
    es: "es_ES",
    ar: "ar_SA",
    "pt-BR": "pt_BR",
  };
  return localeMap[locale] || "en_US";
}

/** Validate a raw header value against the supported locales. */
export function parseLocaleHeader(value: string | null | undefined): Locale {
  if (value && (locales as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return defaultLocale;
}

/**
 * Resolve the active locale for metadata generation. Falls back to the
 * default locale when the header is missing (e.g. static export) or when
 * `headers()` is unavailable outside a request scope.
 */
export async function resolveMetadataLocale(): Promise<Locale> {
  try {
    const headerStore = await headers();
    return parseLocaleHeader(headerStore.get(LOCALE_HEADER));
  } catch {
    return defaultLocale;
  }
}

/** Route keys with translated entries under `metadata` in messages/*.json. */
export type LocalizedMetadataKey = "investorDashboard" | "smeDashboard" | "settings";

interface MetadataMessages {
  title: string;
  description: string;
  ogDescription: string;
  ogImageAlt: string;
}

async function loadMetadataMessages(
  locale: Locale,
  key: LocalizedMetadataKey,
): Promise<MetadataMessages> {
  const messages = (await import(`../messages/${locale}.json`)).default as {
    metadata?: Partial<Record<LocalizedMetadataKey, MetadataMessages>>;
  };
  const entry = messages.metadata?.[key];
  if (entry) return entry;

  // Missing translation — fall back to the default locale's strings.
  const fallback = (await import(`../messages/${defaultLocale}.json`)).default as {
    metadata: Record<LocalizedMetadataKey, MetadataMessages>;
  };
  return fallback.metadata[key];
}

export interface LocalizedMetadataOptions {
  /** Key under `metadata` in messages/*.json. */
  key: LocalizedMetadataKey;
  /** Canonical route path, e.g. "/dashboard/investor". */
  path: string;
  /** Static fields merged into the result (keywords, robots, …). */
  base?: Metadata;
}

const SITE_NAME = "Kora Protocol";
const OG_IMAGE = "/og-image.png";

/**
 * Build route metadata with locale-specific title/description and an
 * `openGraph.locale` matching the active locale. The page title relies on the
 * root layout's `%s | Kora Protocol` template; OG/Twitter titles are branded
 * explicitly because the template does not apply to them.
 */
export async function generateLocalizedMetadata({
  key,
  path,
  base = {},
}: LocalizedMetadataOptions): Promise<Metadata> {
  const locale = await resolveMetadataLocale();
  const t = await loadMetadataMessages(locale, key);
  const brandedTitle = `${t.title} | ${SITE_NAME}`;

  return {
    ...base,
    title: t.title,
    description: t.description,
    openGraph: {
      title: brandedTitle,
      description: t.ogDescription,
      url: path,
      siteName: SITE_NAME,
      locale: localeToOgLocale(locale),
      alternateLocale: locales
        .filter((l) => l !== locale)
        .map((l) => localeToOgLocale(l)),
      images: [
        {
          url: OG_IMAGE,
          width: 1200,
          height: 630,
          alt: t.ogImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: brandedTitle,
      description: t.ogDescription,
      images: [OG_IMAGE],
    },
    alternates: { canonical: path },
  };
}
