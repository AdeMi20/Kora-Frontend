"use client";

/**
 * Shared error page UI — Issue #276, extended in #680.
 *
 * Used by every Next.js route-level `error.tsx` boundary, so what lands here
 * reaches the analytics and investor-dashboard routes at once. Logs the error
 * to /api/vitals for monitoring.
 */

import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Home, RefreshCw, Store } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Route-specific heading; defaults to the generic `error.title`. */
  title?: string;
  /** Route-specific explanation; defaults to the generic `error.description`. */
  description?: string;
  /** Boundary name reported alongside the digest, e.g. "SettingsError". */
  boundary?: string;
}

export function ErrorPage({
  error,
  reset,
  title,
  description,
  boundary = "ErrorPage",
}: ErrorPageProps) {
  const t = useTranslations("error");
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the failure so keyboard and screen-reader users land on it
  // instead of wherever focus was inside the segment that just unmounted.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    logger.reportClientError(error, {
      boundary,
      digest: error.digest,
      route: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [error, boundary]);

  /**
   * Most route errors here are a failed data fetch. `reset()` alone re-renders
   * the segment against the same rejected query in cache, so it fails again
   * immediately — the refetch is what actually makes Retry mean something.
   */
  const handleRetry = useCallback(() => {
    void queryClient.refetchQueries({ type: "active" });
    reset();
  }, [queryClient, reset]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
        <AlertTriangle className="h-8 w-8 text-zinc-400" aria-hidden="true" />
      </div>

      {/* The failure itself is the alert; the recovery links below are not. */}
      <div role="alert" aria-live="assertive" className="space-y-2">
        {/* Kora logo text */}
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-500">⬡ Kora</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold text-zinc-100 focus:outline-none"
        >
          {title ?? t("title")}
        </h1>
        <p className="max-w-md text-sm text-zinc-400">{description ?? t("description")}</p>
        {process.env.NODE_ENV === "development" && error.message && (
          <p className="mx-auto max-w-md rounded bg-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-500">
            {error.message}
          </p>
        )}
      </div>

      {/* Wraps so the three actions do not overflow a narrow viewport once
          translated — the Spanish and Arabic labels are appreciably longer. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" onClick={handleRetry} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("tryAgain")}
        </Button>
        <Button asChild variant="outline">
          <Link href="/marketplace" className="inline-flex items-center gap-2">
            <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("goMarketplace")}
          </Link>
        </Button>
        <Button asChild>
          <Link href="/" className="inline-flex items-center gap-2">
            <Home className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("goHome")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
