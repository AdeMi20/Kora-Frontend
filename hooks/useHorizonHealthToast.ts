"use client";

/**
 * useHorizonHealthToast — surface degraded Horizon health as a toast (Issue #1007)
 *
 * The navbar dot only changes colour when Horizon slows down or fails, so users
 * who never open the network tooltip have no idea their balances may be stale.
 * This hook watches the Horizon service status and raises a dismissible toast
 * when it transitions into `degraded` or `down`.
 *
 * - **Throttled** — each severity toasts at most once per browser session, so
 *   the 60s polling interval and operational ⇄ degraded flapping cannot spam.
 * - **Self-clearing** — returning to `operational` dismisses the toast, so a
 *   recovered network never leaves a stale error on screen.
 * - **Offline-aware** — while the browser is offline every health check fails;
 *   the indicator already shows "Offline", so no Horizon toast is raised.
 *
 * Animation is handled by sonner, whose stylesheet disables toast transitions
 * under `prefers-reduced-motion`.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/useToast";
import type { NetworkStatus } from "@/hooks/useNetworkStatus";

export const HORIZON_HEALTH_TOAST_ID = "horizon-health";
const STORAGE_KEY = "kora-horizon-health-toasted";

type Severity = Exclude<NetworkStatus, "operational">;

// Module state is the source of truth; sessionStorage only carries it across
// reloads within the same tab session and may be unavailable (private mode).
const notified = new Set<Severity>();
let hydrated = false;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const s of parsed) {
        if (s === "degraded" || s === "down") notified.add(s);
      }
    }
  } catch {
    // Storage blocked — fall back to in-memory throttling only.
  }
}

function markNotified(severity: Severity) {
  notified.add(severity);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(notified)));
  } catch {
    // Storage blocked — in-memory throttling still applies.
  }
}

/** Clears the per-session throttle. Exposed for tests. */
export function resetHorizonHealthToastThrottle() {
  notified.clear();
  hydrated = false;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useHorizonHealthToast(
  status: NetworkStatus,
  isOnline: boolean,
  onRetry?: () => void,
) {
  const t = useTranslations("network");
  const toast = useToast();
  const previous = useRef<NetworkStatus>("operational");

  // Keep the latest callbacks without re-running the transition effect.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    const prev = previous.current;
    previous.current = status;

    if (status === "operational") {
      if (prev !== "operational") toastRef.current.dismiss(HORIZON_HEALTH_TOAST_ID);
      return;
    }

    if (!isOnline || status === prev) return;

    hydrate();
    if (notified.has(status)) return;
    markNotified(status);

    toastRef.current.error(
      status === "down" ? t("horizonDownToast") : t("horizonDegradedToast"),
      t("horizonToastHint"),
      onRetryRef.current ? () => onRetryRef.current?.() : undefined,
      HORIZON_HEALTH_TOAST_ID,
    );
  }, [status, isOnline, t]);
}
