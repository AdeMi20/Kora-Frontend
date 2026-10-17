"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWallet } from "@/hooks/useWallet";
import { useUIStore } from "@/store";
import { WalletButton } from "@/components/wallet/WalletButton";

function IntendedDestinationSetter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setIntendedDestination, intendedDestination } = useUIStore();

  useEffect(() => {
    // First priority: redirectTo query param (explicit redirect URL)
    const redirectTo = searchParams.get("redirectTo");
    if (redirectTo) {
      setIntendedDestination(redirectTo);
      return;
    }

    // Second priority: current pathname for protected routes (implicit redirect)
    // Only set if not already set to avoid overwriting an existing intended destination
    if (!intendedDestination) {
      const isProtectedRoute = [
        "/invoice/create",
        "/dashboard/sme",
        "/dashboard/investor",
        "/secondary",
        "/analytics",
      ].some((p) => pathname === p || pathname.startsWith(p + "/"));

      if (isProtectedRoute) {
        setIntendedDestination(pathname);
      }
    }
  }, [pathname, searchParams, setIntendedDestination, intendedDestination]);

  return null;
}

import { Suspense } from "react";

/**
 * Lightweight, non-blank fallback shown while search-params resolution
 * suspends. It reserves a stable, full-height region so the surrounding
 * route chrome does not jump when the real content streams in.
 */
function IntendedDestinationFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full items-center justify-center p-4"
    >
      <span className="sr-only">Loading…</span>
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground"
      />
    </div>
  );
}

/**
 * Wallet-connection guard for protected routes.
 *
 * This component intentionally enforces only *wallet connection* — not KYB/KYC
 * verification status.  The reasoning mirrors the middleware comment:
 *
 *  - Wallet connection state lives in the browser (extension + localStorage).
 *  - KYB status (`kycStatus`) is also stored client-side in Zustand
 *    (persisted to localStorage) and is not accessible to server-side
 *    middleware or this layout-level component without prop-drilling.
 *
 * KYB enforcement for invoice minting (Issue #489) is handled directly inside
 * `app/invoice/create/page.tsx` via the `kyb-mint-gate` feature flag, where the
 * full Zustand store is available and the wizard step context is known.
 */
export function ConnectWalletGuard({ children }: { children: React.ReactNode }) {
  const t = useTranslations("wallet");
  const pathname = usePathname();
  const { isConnected } = useWallet();

  if (
    !isConnected &&
    ["/invoice/create", "/dashboard/sme", "/dashboard/investor", "/secondary", "/analytics"].some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    )
  ) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h3 className="text-lg font-bold">{t("connectGuardTitle")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t("connectGuardDesc")}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <WalletButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={<IntendedDestinationFallback />}>
        <IntendedDestinationSetter />
      </Suspense>
      {children}
    </>
  );
}
