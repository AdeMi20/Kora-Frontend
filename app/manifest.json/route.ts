/**
 * Locale-aware PWA manifest route (#988).
 *
 * Serves `/manifest.json` — the URL referenced by the `manifest` metadata in
 * `app/layout.tsx` — rendered for the active locale, so installed-app shortcuts
 * and screenshot labels match the app's language. The static
 * `public/manifest.json` was replaced by this handler; English remains the
 * default fallback via `buildManifest`.
 */
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE_NAME, resolveLocaleFromRequest } from "@/i18n/locale";
import { buildManifest } from "@/lib/pwa/manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocaleFromRequest(
    cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    headerList.get("accept-language") ?? ""
  );

  return new NextResponse(JSON.stringify(buildManifest(locale), null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // The manifest varies per kora-locale cookie; let the client revalidate.
      "Cache-Control": "no-cache",
    },
  });
}
