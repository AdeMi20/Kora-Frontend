"use client";

/**
 * Root global error boundary (App Router `global-error.tsx`).
 *
 * Route-level `error.tsx` boundaries only catch errors thrown *below* the root
 * layout, so a failure in the layout itself, in `Providers`, or while the
 * provider tree is mounting would otherwise escape every localised error UI and
 * leave the user staring at a blank document or a half-rendered shell.
 *
 * This is the last line of defence. Next.js unmounts the entire tree when it
 * renders, so this component must be self-sufficient:
 *  - it renders its own `<html>` / `<body>` (it replaces the root layout),
 *  - it does not call `useTranslations` or any provider hook, because the
 *    provider tree it would read from may be exactly what just failed, and
 *  - recovery leans on `reset()` plus a hard `window.location.reload()` rather
 *    than assuming any context (query client, router, theme) is mounted.
 *
 * Copy is reused from the shared error UI patterns (`ui/error-boundary.tsx`,
 * `ui/ErrorPage.tsx`) and translated under the `globalError` message namespace.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { resolveLocale } from "@/i18n/locale";
import { defaultLocale, isRTL, type Locale } from "@/i18n/config";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import ar from "@/messages/ar.json";
import ptBR from "@/messages/pt-BR.json";

interface GlobalErrorCopy {
  title: string;
  description: string;
  tryAgain: string;
  reload: string;
}

/**
 * The four locale bundles are imported directly instead of read through
 * next-intl: `useTranslations` needs a provider, and the provider tree is one of
 * the things that can throw above this boundary.
 */
const MESSAGES: Record<Locale, GlobalErrorCopy> = {
  en: (en as { globalError: GlobalErrorCopy }).globalError,
  es: (es as { globalError: GlobalErrorCopy }).globalError,
  ar: (ar as { globalError: GlobalErrorCopy }).globalError,
  "pt-BR": (ptBR as { globalError: GlobalErrorCopy }).globalError,
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Start from the default locale so the server-rendered HTML and the first
  // client render agree, then resolve the real locale once mounted.
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocale(resolveLocale());
  }, []);

  useEffect(() => {
    // `reportClientError` redacts Stellar public keys (i.e. wallet addresses),
    // secrets, and JWTs before logging or shipping to /api/vitals, so nothing
    // that identifies the user's wallet leaves the client.
    void logger.reportClientError(error, {
      boundary: "GlobalError",
      digest: error.digest,
      route: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [error]);

  const copy = MESSAGES[locale] ?? MESSAGES[defaultLocale];
  const dir = isRTL(locale) ? "rtl" : "ltr";

  /**
   * Reset the boundary in place, then hard-reload so the application
   * re-bootstraps from scratch. Guarded so it is safe even if `reset` is a
   * no-op stub or `window` is unavailable.
   */
  const handleRecover = () => {
    try {
      reset();
    } catch {
      // reset() is a Next-provided contract; ignore if a stub is missing.
    }
    reloadPage();
  };

  /** Full-page reload that does not depend on any mounted provider. */
  const reloadPage = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <html lang={locale} dir={dir}>
      <body>
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center"
          style={{ backgroundColor: "#09090b", color: "#f4f4f5" }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
            <AlertTriangle className="h-8 w-8 text-zinc-400" aria-hidden="true" />
          </div>

          <div role="alert" aria-live="assertive" className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-500">
              ⬡ Kora
            </p>
            <h1 className="text-2xl font-bold text-zinc-100">{copy.title}</h1>
            <p className="max-w-md text-sm text-zinc-400">{copy.description}</p>
            {process.env.NODE_ENV === "development" && error.message && (
              <p className="mx-auto max-w-md rounded bg-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-500">
                {error.message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" onClick={handleRecover} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {copy.tryAgain}
            </Button>
            {/* A plain reload is the fallback when `reset()` is unavailable,
                because the provider tree may never have mounted to handle it. */}
            <Button variant="ghost" onClick={reloadPage} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {copy.reload}
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
