import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import ar from "@/messages/ar.json";
import ptBR from "@/messages/pt-BR.json";
import { locales, type Locale } from "@/i18n/config";
import { THEME_COLORS } from "@/lib/theme";
import {
  DEFAULT_MESSAGES,
  MANIFEST_SHORTCUT_DEFINITIONS,
  buildManifest,
  resolveManifestString,
  type MessagesByLocale,
} from "@/lib/pwa/manifest";

const BUNDLES: Record<Locale, Record<string, unknown>> = {
  en,
  es,
  ar,
  "pt-BR": ptBR,
};

describe("localized PWA manifest (#988)", () => {
  it.each(locales)("reports the active locale as the manifest lang (%s)", (locale) => {
    expect(buildManifest(locale).lang).toBe(locale);
  });

  it.each(locales)(
    "maps shortcut names to the translated navbar labels (%s)",
    (locale) => {
      const manifest = buildManifest(locale);
      const nav = BUNDLES[locale].nav as Record<string, string>;

      const marketplace = manifest.shortcuts.find((s) => s.url === "/marketplace");
      const createInvoice = manifest.shortcuts.find((s) => s.url === "/invoice/create");

      expect(marketplace?.name).toBe(nav.marketplace);
      expect(createInvoice?.name).toBe(nav.createInvoice);
    }
  );

  it("localizes shortcut descriptions and screenshot labels", () => {
    const enManifest = buildManifest("en");
    const esManifest = buildManifest("es");
    const arManifest = buildManifest("ar");

    const enDescription = enManifest.shortcuts.find((s) => s.url === "/marketplace")!
      .description;
    const esDescription = esManifest.shortcuts.find((s) => s.url === "/marketplace")!
      .description;
    const arDescription = arManifest.shortcuts.find((s) => s.url === "/marketplace")!
      .description;

    expect(enDescription).toBe("Browse invoice listings");
    expect(esDescription).not.toBe(enDescription);
    expect(arDescription).not.toBe(enDescription);
    expect(esDescription).not.toBe(arDescription);

    expect(esManifest.screenshots[0].label).not.toBe(enManifest.screenshots[0].label);
    expect(arManifest.screenshots[1].label).not.toBe(enManifest.screenshots[1].label);
  });

  it("keeps shortcut URLs and icon paths stable across locales", () => {
    const baseline = buildManifest("en");

    const urls = baseline.shortcuts.map((s) => s.url).sort();
    const icons = JSON.stringify(baseline.icons);

    // Locale-agnostic app paths — never prefixed with the locale.
    expect(urls).toEqual(["/invoice/create", "/marketplace"]);
    expect(urls.some((url) => url.startsWith("/es") || url.startsWith("/ar"))).toBe(
      false
    );

    for (const locale of locales) {
      const manifest = buildManifest(locale);
      expect(manifest.shortcuts.map((s) => s.url)).toEqual(
        baseline.shortcuts.map((s) => s.url)
      );
      expect(JSON.stringify(manifest.icons)).toBe(icons);
      expect(manifest.screenshots.map((s) => s.src)).toEqual(
        baseline.screenshots.map((s) => s.src)
      );
    }
  });

  it("has no duplicate shortcuts and matches the shortcut definitions", () => {
    const manifest = buildManifest("pt-BR");
    const urls = manifest.shortcuts.map((s) => s.url);
    expect(urls).toHaveLength(MANIFEST_SHORTCUT_DEFINITIONS.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("falls back to English for missing keys", () => {
    const partial: MessagesByLocale = {
      ...DEFAULT_MESSAGES,
      es: { nav: { marketplace: "Mercado" } },
    };

    const manifest = buildManifest("es", partial);

    // Present key is used…
    expect(manifest.shortcuts.find((s) => s.url === "/marketplace")!.name).toBe(
      "Mercado"
    );
    // …while the missing ones fall back to English rather than undefined.
    expect(manifest.shortcuts.find((s) => s.url === "/invoice/create")!.name).toBe(
      en.nav.createInvoice
    );
    expect(manifest.screenshots[0].label).toBe(en.pwa.manifest.screenshots.wide);
    expect(manifest.shortcuts.find((s) => s.url === "/marketplace")!.description).toBe(
      en.pwa.manifest.shortcuts.marketplace.description
    );
  });

  it("defaults to English when the locale bundle is absent", () => {
    const manifest = buildManifest("es", { en: DEFAULT_MESSAGES.en });
    expect(manifest.shortcuts[0].name).toBe(en.nav.marketplace);
  });

  it("uses the shared light/dark chrome tokens for theme_color", () => {
    const manifest = buildManifest("en");
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    expect(manifest.background_color).toBe(THEME_COLORS.dark);
  });
});

describe("resolveManifestString", () => {
  it("prefers the locale value, then the fallback, then the default", () => {
    const localized = { pwa: { manifest: { key: "localizado" } } };
    const fallback = { pwa: { manifest: { key: "fallback", other: "x" } } };

    expect(resolveManifestString(localized, fallback, "pwa.manifest.key", "d")).toBe(
      "localizado"
    );
    expect(resolveManifestString(localized, fallback, "pwa.manifest.other", "d")).toBe(
      "x"
    );
    expect(resolveManifestString(localized, fallback, "pwa.manifest.missing", "d")).toBe(
      "d"
    );
    expect(resolveManifestString(undefined, undefined, "pwa.manifest.missing", "d")).toBe(
      "d"
    );
  });
});
