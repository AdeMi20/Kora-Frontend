import type { Metadata, Viewport } from "next";
import type { NextWebVitalsMetric } from "next/app";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { WrongNetworkBanner } from "@/components/wallet/WrongNetworkBanner";
import { PageTransition } from "@/components/layout/PageTransition";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { env } from "@/lib/env";
import { websiteSchema, organizationSchema, serializeSchema } from "@/lib/structuredData";
import { WebVitalsReporter } from "@/components/dev/WebVitalsReporter";
import { WebVitalsPanel as WebVitalsPanelClient } from "@/components/dev/WebVitalsPanel";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { THEME_INIT_SCRIPT, buildViewportThemeColor } from "@/lib/theme";

const WebVitalsPanel =
  process.env.NODE_ENV === "development"
    ? WebVitalsPanelClient
    : () => null;

// Optimised font loading: display=swap prevents render-blocking, subset limits
// download size. Both fonts are preloaded by next/font automatically.
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});
const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false, // mono font is not LCP-critical; defer to reduce initial load
});

/**
 * Generate hreflang alternate URLs for all supported locales.
 */
function generateHreflangAlternates(pathname: string = "/") {
  const alternates: Record<string, string> = {};
  
  for (const locale of locales) {
    const localePath = locale === defaultLocale ? pathname : `/${locale}${pathname}`;
    alternates[locale] = `${env.NEXT_PUBLIC_APP_URL}${localePath}`;
  }
  
  return alternates;
}

/**
 * Map locale code to OpenGraph locale format.
 */
function localeToOgLocale(locale: Locale): string {
  const localeMap: Record<Locale, string> = {
    en: "en_US",
    es: "es_ES",
    ar: "ar_SA",
    "pt-BR": "pt_BR",
  };
  return localeMap[locale] || "en_US";
}

/**
 * Locales that render right-to-left. Kept in sync with i18n/config.
 */
const RTL_LOCALES: ReadonlySet<string> = new Set(["ar"]);

/**
 * Resolve the active locale on the server so the first HTML response carries
 * the correct `lang`/`dir` attributes. Middleware sets `x-kora-locale` from
 * the cookie / Accept-Language; fall back to the default locale when absent.
 */
function resolveServerLocale(): Locale {
  const headerLocale = headers().get("x-kora-locale");
  if (headerLocale && (locales as readonly string[]).includes(headerLocale)) {
    return headerLocale as Locale;
  }
  return defaultLocale;
}

// ─── Site-wide metadata ───────────────────────────────────────────────────────
// Per-page metadata is exported from each page's layout or page file.
// The `template` ensures every page title follows "Page Name | Kora Protocol".
export const metadata: Metadata = {
  // metadataBase is required for absolute URLs in openGraph/twitter images
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),

  title: {
    default: "Kora Protocol — On-Chain Invoice Financing",
    template: "%s | Kora Protocol",
  },
  description:
    "SMEs tokenize unpaid invoices as NFTs on Stellar Soroban and sell them at a discount to global liquidity providers — unlocking instant stablecoin liquidity without banks.",
  keywords: [
    "invoice financing",
    "DeFi",
    "Stellar",
    "Soroban",
    "SME",
    "liquidity",
    "invoice NFT",
    "stablecoin",
    "USDC",
    "emerging markets",
    "Africa",
    "trade finance",
  ],
  authors: [{ name: "Kora Protocol" }],
  creator: "Kora Protocol",
  publisher: "Kora Protocol",

  // Canonical URL — Next.js uses metadataBase + path automatically
  alternates: {
    canonical: "/",
    languages: generateHreflangAlternates(),
  },

  // Robots: index all pages, follow links
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // Open Graph
  openGraph: {
    type: "website",
    locale: localeToOgLocale(defaultLocale),
    url: "/",
    siteName: "Kora Protocol",
    title: "Kora Protocol — On-Chain Invoice Financing",
    description:
      "Tokenize invoices as NFTs on Stellar Soroban. Instant USDC liquidity for SMEs, transparent yield for investors.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Kora Protocol — On-Chain Invoice Financing on Stellar",
      },
    ],
  },

  // Twitter / X card
  twitter: {
    card: "summary_large_image",
    site: "@KoraProtocol",
    creator: "@KoraProtocol",
    title: "Kora Protocol — On-Chain Invoice Financing",
    description:
      "Tokenize invoices as NFTs on Stellar Soroban. Instant USDC liquidity for SMEs.",
    images: ["/og-image.png"],
  },

  // App manifest / theme
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kora",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Light/dark browser-chrome colors come from `lib/theme` so the metadata
  // export, the inline bootstrap script and ThemeProvider share one token set.
  themeColor: buildViewportThemeColor(),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveServerLocale();
  const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Security: static compile-time string from lib/theme, zero user input — safe for dangerouslySetInnerHTML.
            Runs synchronously before first paint to prevent flash of incorrect theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Apple PWA meta — Next.js metadata API doesn't cover all apple-* tags */}
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Resource hints: URLs sourced from env vars; testnet hints omitted in production */}
        {env.NEXT_PUBLIC_STELLAR_RPC_URL && (
          <link rel="preconnect" href={new URL(env.NEXT_PUBLIC_STELLAR_RPC_URL).origin} crossOrigin="anonymous" />
        )}
        {env.NEXT_PUBLIC_STELLAR_HORIZON_URL && (
          <link rel="preconnect" href={new URL(env.NEXT_PUBLIC_STELLAR_HORIZON_URL).origin} crossOrigin="anonymous" />
        )}
        {env.NEXT_PUBLIC_IPFS_GATEWAY && (
          <>
            <link rel="preconnect" href={new URL(env.NEXT_PUBLIC_IPFS_GATEWAY).origin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={new URL(env.NEXT_PUBLIC_IPFS_GATEWAY).origin} />
          </>
        )}
        {/* Structured data: WebSite + Organization for SEO ≥ 95 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeSchema(websiteSchema()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeSchema(organizationSchema()) }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} bg-background antialiased`}>
        {/* Skip link — must be first focusable element; meets WCAG 2.1 AA (2.4.1) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
        >
          Skip to main content
        </a>
        <Providers initialLocale={locale}>
          <WebVitalsReporter />
          <Navbar />
          <WrongNetworkBanner />
          <main id="main-content" className="min-h-screen">
            <PageTransition>{children}</PageTransition>
          </main>
          <WebVitalsPanel />
          <InstallPrompt />
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
