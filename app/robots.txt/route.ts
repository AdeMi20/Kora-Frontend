/**
 * robots.txt — Issue #305
 *
 * Allows all crawlers to index public pages while blocking
 * /api/ and wallet-gated routes from search engines. Keep the wallet-gated
 * list in sync with the sitemap exclusions in `app/sitemap.xml/route.ts` (#1001).
 */
export function GET() {
  const body = `# Kora Protocol — robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /dashboard/
Disallow: /transactions
Disallow: /invoice/create
Disallow: /analytics
Disallow: /settings

Sitemap: ${process.env.NEXT_PUBLIC_APP_URL || "https://kora.finance"}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
