/**
 * Localized PWA manifest builder (#988).
 *
 * The manifest used to be a static `public/manifest.json` with hardcoded
 * English shortcut names, short_names, descriptions and screenshot labels.
 * Installed-app shortcuts therefore ignored all of the in-app i18n work: a
 * Spanish user got an English "Marketplace" tile.
 *
 * `buildManifest` renders the manifest per locale. Shortcut *names* are reused
 * from the translated navbar labels (`nav.marketplace` / `nav.createInvoice`)
 * so a shortcut's title matches the destination's nav entry, and the remaining
 * strings come from the `pwa.manifest` message namespace. Any missing key falls
 * back to English, so the manifest is always valid.
 *
 * Shortcut URLs are intentionally locale-agnostic app paths: the active locale
 * lives in the `kora-locale` cookie and on `document.lang`, not in the URL, so
 * another locale's manifest must not ship prefixed paths.
 */
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import arMessages from "@/messages/ar.json";
import ptBRMessages from "@/messages/pt-BR.json";
import { defaultLocale, type Locale } from "@/i18n/config";
import { THEME_COLORS } from "@/lib/theme";

export type MessageBundle = Record<string, unknown>;
export type MessagesByLocale = Partial<Record<Locale, MessageBundle>>;

/** Canonical manifest URL referenced by `app/layout.tsx` metadata. */
export const MANIFEST_PATH = "/manifest.json";

/** Locale-agnostic product strings that are out of i18n scope today. */
const PRODUCT_NAME = "Kora Protocol";
const PRODUCT_SHORT_NAME = "Kora";
const PRODUCT_DESCRIPTION =
  "On-chain invoice financing on Stellar Soroban. Tokenize invoices as NFTs and access instant USDC liquidity.";

const ICONS = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any maskable",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any maskable",
  },
];

export const DEFAULT_MESSAGES: MessagesByLocale = {
  en: enMessages as MessageBundle,
  es: esMessages as MessageBundle,
  ar: arMessages as MessageBundle,
  "pt-BR": ptBRMessages as MessageBundle,
};

interface ShortcutDefinition {
  id: "marketplace" | "createInvoice";
  /** Path used for both the shortcut URL and the translated nav label. */
  url: string;
  navKey: string;
}

export const MANIFEST_SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: "marketplace", url: "/marketplace", navKey: "nav.marketplace" },
  { id: "createInvoice", url: "/invoice/create", navKey: "nav.createInvoice" },
];

function getString(messages: MessageBundle | undefined, path: string): string | undefined {
  if (!messages) return undefined;
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, segment) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[segment]
          : undefined,
      messages
    );
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolve a `pwa.manifest`-namespaced string, falling back to the English
 * bundle and finally to an explicit default. Exported for unit tests.
 */
export function resolveManifestString(
  messages: MessageBundle | undefined,
  fallbackMessages: MessageBundle | undefined,
  path: string,
  defaultValue: string
): string {
  return (
    getString(messages, path) ??
    getString(fallbackMessages, path) ??
    defaultValue
  );
}

export interface WebAppManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  categories: string[];
  lang: string;
  icons: typeof ICONS;
  screenshots: Array<{
    src: string;
    sizes: string;
    type: string;
    form_factor: "wide" | "narrow";
    label: string;
  }>;
  shortcuts: Array<{
    name: string;
    short_name: string;
    description: string;
    url: string;
    icons: Array<{ src: string; sizes: string }>;
  }>;
}

export function buildManifest(
  locale: Locale = defaultLocale,
  messagesByLocale: MessagesByLocale = DEFAULT_MESSAGES
): WebAppManifest {
  const messages = messagesByLocale[locale] ?? messagesByLocale[defaultLocale];
  const fallback = messagesByLocale[defaultLocale];

  const t = (path: string, defaultValue: string) =>
    resolveManifestString(messages, fallback, path, defaultValue);

  const shortcuts = MANIFEST_SHORTCUT_DEFINITIONS.map(({ id, url, navKey }) => ({
    // Reuse the translated navbar label so the shortcut and the destination
    // navigation entry read identically in every locale.
    name: t(navKey, id === "marketplace" ? "Marketplace" : "Create Invoice"),
    short_name: t(`pwa.manifest.shortcuts.${id}.shortName`, "Kora"),
    description: t(`pwa.manifest.shortcuts.${id}.description`, ""),
    url,
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
  }));

  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_SHORT_NAME,
    description: PRODUCT_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    categories: ["finance", "business"],
    lang: locale,
    icons: ICONS,
    screenshots: [
      {
        src: "/icons/screenshot-wide.png",
        sizes: "1280x720",
        type: "image/png",
        form_factor: "wide",
        label: t("pwa.manifest.screenshots.wide", "Kora Protocol Marketplace"),
      },
      {
        src: "/icons/screenshot-narrow.png",
        sizes: "390x844",
        type: "image/png",
        form_factor: "narrow",
        label: t("pwa.manifest.screenshots.narrow", "Kora Protocol on Mobile"),
      },
    ],
    shortcuts,
  };
}
