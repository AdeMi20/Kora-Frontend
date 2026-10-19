/**
 * sitemap.xml — Issues #305 / #375 / #1001 / #1002
 *
 * Generates a sitemap with all public pages plus marketplace invoice URLs.
 * Uses mock data (and optional live fetch) without importing `@/lib/env` at
 * module scope so `next build` succeeds in CI with partial env.
 *
 * Only publicly browsable content belongs here. Wallet-gated flows
 * (`/transactions`, `/invoice/create`, `/analytics`, `/dashboard/*`,
 * `/settings`) are deliberately omitted: they render nothing useful without a
 * connected wallet, already set `robots: noindex` in their layouts, and are
 * disallowed in `app/robots.txt/route.ts`.
 *
 * `/secondary` is emitted only when the `secondary-market` flag is on at
 * request time (#1002), so crawlers are not sent to a disabled feature.
 */

import { MOCK_INVOICES } from "@/services/mockData";
import { isSecondaryMarketEnabledOnServer } from "@/lib/serverFeatureFlags";
import type { Invoice } from "@/types";

// Wallet-gated routes must never be listed here — `__tests__/sitemap.test.ts`
// asserts they are absent from the generated XML.
const STATIC_PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/marketplace", changefreq: "hourly", priority: "0.9" },
];

/** Secondary market listing page — gated by the `secondary-market` flag. */
const SECONDARY_PAGE = { path: "/secondary", changefreq: "hourly", priority: "0.7" };

const PUBLIC_STATUSES = new Set([
  "listed",
  "partially_funded",
  "fully_funded",
  "active",
  "repaid",
]);

function escapeXml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlEntry(
  baseUrl: string,
  path: string,
  lastmod: string,
  changefreq: string,
  priority: string
) {
  return `  <url>
    <loc>${escapeXml(`${baseUrl}${path}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

/** Sitemap entry pattern for invoice detail pages (Issue #375). */
function invoiceSitemapEntries(
  invoices: Pick<Invoice, "id" | "status" | "updatedAt">[]
) {
  return invoices
    .filter((inv) => PUBLIC_STATUSES.has(inv.status))
    .map((inv) => ({
      path: `/marketplace/${inv.id}`,
      lastmod: (inv.updatedAt || new Date().toISOString()).slice(0, 10),
      changefreq: "daily" as const,
      priority: "0.8",
    }));
}

async function loadInvoicesForSitemap(): Promise<
  Pick<Invoice, "id" | "status" | "updatedAt">[]
> {
  // Prefer mock data when enabled (CI / local default) — no env module needed.
  if (process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA !== "false") {
    return MOCK_INVOICES;
  }

  try {
    const { fetchInvoices } = await import("@/services/invoiceService");
    const page = await fetchInvoices(undefined, undefined, 1, 100);
    return page.data ?? [];
  } catch {
    return MOCK_INVOICES;
  }
}

export async function GET() {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://kora.finance";
  const now = new Date().toISOString().split("T")[0];

  const pages = isSecondaryMarketEnabledOnServer()
    ? [...STATIC_PAGES, SECONDARY_PAGE]
    : STATIC_PAGES;

  const staticEntries = pages.map((page) =>
    urlEntry(baseUrl, page.path, now, page.changefreq, page.priority)
  );

  let invoiceEntries: string[] = [];
  try {
    const invoices = await loadInvoicesForSitemap();
    invoiceEntries = invoiceSitemapEntries(invoices).map((e) =>
      urlEntry(baseUrl, e.path, e.lastmod || now, e.changefreq, e.priority)
    );
  } catch {
    // Sitemap still returns static pages if invoice listing fails
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...invoiceEntries].join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
