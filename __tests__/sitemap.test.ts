/**
 * sitemap.xml / robots.txt route tests — Issues #1001 / #1002
 *
 * - Wallet-gated routes never appear in the sitemap (and stay disallowed in
 *   robots.txt), so a future STATIC_PAGES edit cannot reintroduce them.
 * - Public marketing + marketplace URLs remain present.
 * - `/secondary` is emitted only when NEXT_PUBLIC_ENABLE_SECONDARY_MARKET is
 *   literally "true", mirroring `lib/featureFlags.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getSitemap } from "@/app/sitemap.xml/route";
import { GET as getRobots } from "@/app/robots.txt/route";

const BASE_URL = "https://kora.test";

const WALLET_GATED_PATHS = [
  "/transactions",
  "/invoice/create",
  "/analytics",
  "/dashboard",
  "/settings",
];

async function sitemapXml(): Promise<string> {
  const res = await getSitemap();
  return res.text();
}

function locs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (m) => m[1]!);
}

function entryFor(xml: string, path: string): string | undefined {
  return xml
    .split("<url>")
    .find((chunk) => chunk.includes(`<loc>${BASE_URL}${path}</loc>`));
}

describe("sitemap.xml", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", BASE_URL);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK_DATA", "true");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns XML with the sitemap content type", async () => {
    const res = await getSitemap();
    expect(res.headers.get("Content-Type")).toBe("application/xml");
    expect(await res.text()).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
  });

  it("keeps public marketing and marketplace URLs", async () => {
    const urls = locs(await sitemapXml());
    expect(urls).toContain(`${BASE_URL}/`);
    expect(urls).toContain(`${BASE_URL}/marketplace`);
    expect(urls.some((u) => u.startsWith(`${BASE_URL}/marketplace/`))).toBe(true);
  });

  it.each(WALLET_GATED_PATHS)("excludes wallet-gated route %s", async (path) => {
    const urls = locs(await sitemapXml());
    for (const url of urls) {
      const pathname = url.slice(BASE_URL.length);
      expect(pathname === path || pathname.startsWith(`${path}/`)).toBe(false);
    }
  });

  it("omits /secondary when the secondary-market flag is off", async () => {
    expect(locs(await sitemapXml())).not.toContain(`${BASE_URL}/secondary`);
  });

  it("omits /secondary when the flag env var is unset", async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_SECONDARY_MARKET;
    expect(locs(await sitemapXml())).not.toContain(`${BASE_URL}/secondary`);
  });

  it("omits /secondary for non-literal truthy values", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "TRUE");
    expect(locs(await sitemapXml())).not.toContain(`${BASE_URL}/secondary`);
  });

  it("includes /secondary with hourly changefreq when the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "true");
    const xml = await sitemapXml();
    const entry = entryFor(xml, "/secondary");

    expect(entry).toBeDefined();
    expect(entry).toContain("<changefreq>hourly</changefreq>");
    expect(entry).toContain("<priority>0.7</priority>");
  });

  it("only differs by the /secondary entry between flag states", async () => {
    const off = locs(await sitemapXml());
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "true");
    const on = locs(await sitemapXml());

    expect(on.filter((u) => !off.includes(u))).toEqual([`${BASE_URL}/secondary`]);
    expect(off.filter((u) => !on.includes(u))).toEqual([]);
  });
});

describe("robots.txt", () => {
  it.each(WALLET_GATED_PATHS)("disallows wallet-gated route %s", async (path) => {
    const body = await getRobots().text();
    expect(body).toMatch(new RegExp(`^Disallow: ${path}/?$`, "m"));
  });

  it("does not disallow public marketplace or secondary routes", async () => {
    const body = await getRobots().text();
    expect(body).not.toMatch(/^Disallow: \/marketplace/m);
    expect(body).not.toMatch(/^Disallow: \/secondary/m);
  });
});
