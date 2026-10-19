/**
 * Unit tests for locale-aware route metadata (#1004).
 *
 * `next/headers` is mocked so each test controls the `x-kora-locale` header
 * that middleware would normally set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { headerValues, headersMock } = vi.hoisted(() => {
  const headerValues = new Map<string, string>();
  const headersMock = vi.fn(async () => ({
    get: (name: string) => headerValues.get(name.toLowerCase()) ?? null,
  }));
  return { headerValues, headersMock };
});

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

import {
  generateLocalizedMetadata,
  localeToOgLocale,
  parseLocaleHeader,
  resolveMetadataLocale,
} from "../localizedMetadata";
import { generateMetadata as settingsMetadata } from "@/app/settings/layout";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import es from "@/messages/es.json";
import ptBR from "@/messages/pt-BR.json";

function setLocaleHeader(locale: string | null) {
  headerValues.clear();
  if (locale !== null) headerValues.set("x-kora-locale", locale);
}

beforeEach(() => {
  setLocaleHeader(null);
  headersMock.mockClear();
});

describe("localeToOgLocale", () => {
  it("maps every supported locale to an OG locale", () => {
    expect(localeToOgLocale("en")).toBe("en_US");
    expect(localeToOgLocale("es")).toBe("es_ES");
    expect(localeToOgLocale("ar")).toBe("ar_SA");
    expect(localeToOgLocale("pt-BR")).toBe("pt_BR");
  });
});

describe("parseLocaleHeader / resolveMetadataLocale", () => {
  it("accepts supported locales and rejects unknown values", () => {
    expect(parseLocaleHeader("ar")).toBe("ar");
    expect(parseLocaleHeader("fr")).toBe("en");
    expect(parseLocaleHeader(null)).toBe("en");
  });

  it("falls back to the default locale when the header is missing", async () => {
    await expect(resolveMetadataLocale()).resolves.toBe("en");
  });

  it("falls back to the default locale when headers() throws (static export)", async () => {
    headersMock.mockRejectedValueOnce(new Error("outside request scope"));
    await expect(resolveMetadataLocale()).resolves.toBe("en");
  });
});

describe("generateLocalizedMetadata", () => {
  it("uses English strings and en_US OG locale for en", async () => {
    setLocaleHeader("en");
    const meta = await generateLocalizedMetadata({
      key: "investorDashboard",
      path: "/dashboard/investor",
    });

    expect(meta.title).toBe(en.metadata.investorDashboard.title);
    expect(meta.description).toBe(en.metadata.investorDashboard.description);
    expect(meta.openGraph).toMatchObject({
      title: `${en.metadata.investorDashboard.title} | Kora Protocol`,
      description: en.metadata.investorDashboard.ogDescription,
      url: "/dashboard/investor",
      locale: "en_US",
    });
    expect(meta.alternates).toEqual({ canonical: "/dashboard/investor" });
  });

  it("uses Arabic strings and ar_SA OG locale for ar", async () => {
    setLocaleHeader("ar");
    const meta = await generateLocalizedMetadata({
      key: "smeDashboard",
      path: "/dashboard/sme",
    });

    expect(meta.title).toBe(ar.metadata.smeDashboard.title);
    expect(meta.description).toBe(ar.metadata.smeDashboard.description);
    expect(meta.openGraph).toMatchObject({
      title: `${ar.metadata.smeDashboard.title} | Kora Protocol`,
      locale: "ar_SA",
    });
    expect((meta.openGraph as { alternateLocale: string[] }).alternateLocale).not.toContain(
      "ar_SA",
    );
    expect(meta.twitter).toMatchObject({
      title: `${ar.metadata.smeDashboard.title} | Kora Protocol`,
      description: ar.metadata.smeDashboard.ogDescription,
    });
  });

  it("falls back to English when the header is missing", async () => {
    const meta = await generateLocalizedMetadata({ key: "settings", path: "/settings" });

    expect(meta.title).toBe(en.metadata.settings.title);
    expect((meta.openGraph as { locale: string }).locale).toBe("en_US");
  });

  it("preserves base fields such as noindex robots", async () => {
    setLocaleHeader("es");
    const meta = await generateLocalizedMetadata({
      key: "settings",
      path: "/settings",
      base: { robots: { index: false, follow: false }, keywords: ["k"] },
    });

    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.keywords).toEqual(["k"]);
    expect(meta.title).toBe(es.metadata.settings.title);
  });
});

describe("settings layout generateMetadata", () => {
  it("emits locale-specific OG tags and stays noindex", async () => {
    setLocaleHeader("pt-BR");
    const meta = await settingsMetadata();

    expect(meta.title).toBe(ptBR.metadata.settings.title);
    expect((meta.openGraph as { locale: string }).locale).toBe("pt_BR");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe("messages/*.json metadata keys", () => {
  it("defines every metadata entry in every locale", () => {
    const keys = Object.keys(en.metadata).sort();
    for (const messages of [ar, es, ptBR]) {
      expect(Object.keys(messages.metadata).sort()).toEqual(keys);
      for (const key of keys) {
        const entry = messages.metadata[key as keyof typeof messages.metadata];
        expect(Object.keys(entry).sort()).toEqual(
          ["description", "ogDescription", "ogImageAlt", "title"],
        );
      }
    }
  });
});
