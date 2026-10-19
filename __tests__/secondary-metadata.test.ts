/**
 * Secondary market route metadata — Issue #1000
 *
 * Asserts the shape of the `/secondary` head metadata in both flag states:
 * full title / OG / Twitter tags when enabled, and a minimal `noindex` head
 * when the `secondary-market` flag is off.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSecondaryMetadata, generateMetadata } from "@/app/secondary/metadata";
import { locales } from "@/i18n/config";

describe("buildSecondaryMetadata", () => {
  describe("flag enabled", () => {
    const metadata = buildSecondaryMetadata(true);

    it("has a descriptive title and description", () => {
      expect(metadata.title).toBe("Secondary Market");
      expect(typeof metadata.description).toBe("string");
      expect((metadata.description as string).length).toBeGreaterThan(50);
    });

    it("includes Open Graph tags", () => {
      expect(metadata.openGraph).toMatchObject({
        title: "Secondary Market | Kora Protocol",
        description: expect.any(String),
        url: "/secondary",
        images: [expect.objectContaining({ url: "/og-image.png", width: 1200, height: 630 })],
      });
    });

    it("includes Twitter card fields", () => {
      expect(metadata.twitter).toMatchObject({
        card: "summary_large_image",
        title: "Secondary Market | Kora Protocol",
        description: expect.any(String),
        images: ["/og-image.png"],
      });
    });

    it("sets the canonical URL and hreflang alternates for every locale", () => {
      expect(metadata.alternates?.canonical).toBe("/secondary");
      const languages = metadata.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort()).toEqual([...locales].sort());
      expect(languages.en).toBe("/secondary");
      expect(languages.es).toBe("/es/secondary");
    });

    it("is indexable", () => {
      expect(metadata.robots).toEqual({ index: true, follow: true });
    });
  });

  describe("flag disabled", () => {
    const metadata = buildSecondaryMetadata(false);

    it("is noindex / nofollow", () => {
      expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it("does not advertise the feature in social previews or search", () => {
      expect(metadata.openGraph).toBeUndefined();
      expect(metadata.twitter).toBeUndefined();
      expect(metadata.description).toBeUndefined();
      expect(metadata.alternates).toBeUndefined();
    });
  });
});

describe("generateMetadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the secondary-market flag from env on the server", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "true");
    const metadata = await generateMetadata();
    expect(metadata.openGraph).toBeDefined();
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("returns noindex metadata when the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "false");
    const metadata = await generateMetadata();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
