"use client";

import React from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { StellarTxLink } from "@/components/ui/stellar-tx-link";
import { useSettingsStore } from "@/store/settingsStore";

export type NotificationPreferenceType =
  | "txConfirmed"
  | "invoiceFunded"
  | "maturityReminder"
  | "yieldAvailable";

interface TxToastProps {
  message: string;
  txHash?: string;
  txLinkLabel: string;
}

export function TxToast({ message, txHash, txLinkLabel }: TxToastProps) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1 w-full">
      <span className="font-medium text-foreground">{message}</span>
      {txHash && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
          <span className="shrink-0">{txLinkLabel}</span>
          <StellarTxLink hash={txHash} chars={8} size="sm" />
        </div>
      )}
    </div>
  );
}

interface ErrorToastProps {
  message: string;
  description?: string;
  onRetry?: () => void;
  toastId: string | number;
  retryLabel: string;
  dismissLabel: string;
}

export function ErrorToast({
  message,
  description,
  onRetry,
  toastId,
  retryLabel,
  dismissLabel,
}: ErrorToastProps) {
  return (
    <div role="alert" aria-live="assertive" className="flex flex-col gap-2 w-full">
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-destructive">{message}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {onRetry && (
          <button
            onClick={() => {
              toast.dismiss(toastId);
              onRetry();
            }}
            className="rounded bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity"
          >
            {retryLabel}
          </button>
        )}
        <button
          onClick={() => toast.dismiss(toastId)}
          className="rounded border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Canonical toast API — Issue #691.
 *
 * `hooks/` previously held both a `useToast.ts` and this `useToast.tsx`, with
 * incompatible APIs. Every call site imports the extensionless
 * `@/hooks/useToast`, so resolution order alone decided which one they got —
 * `.ts` wins under bundler resolution, which is why `useTransaction` and
 * `InvoiceDetailClient` were calling a `toast.error` that did not exist on the
 * module they actually resolved to.
 *
 * This is now the only implementation. The thin module's `info` helper is
 * preserved below so its one consumer (`useWatchlistAlerts`) keeps working.
 */
export function useToast() {
  const notificationPreferences = useSettingsStore((s) => s.notifications);
  const t = useTranslations("transaction");

  const shouldNotify = (type?: NotificationPreferenceType) => {
    if (!type) return true;
    return notificationPreferences[type];
  };

  const showLoading = (
    message: string,
    id: string | number,
    type?: NotificationPreferenceType
  ) => {
    if (!shouldNotify(type)) return id;
    return toast.loading(
      <div role="status" aria-live="polite" className="font-medium text-foreground">
        {message}
      </div>,
      { id, duration: Infinity }
    );
  };

  const showSuccess = (
    message: string,
    txHash?: string,
    id?: string | number,
    type?: NotificationPreferenceType
  ) => {
    const toastId = id ?? Math.random().toString();
    if (!shouldNotify(type)) return toastId;
    return toast.success(
      <TxToast message={message} txHash={txHash} txLinkLabel={t("txLink")} />,
      {
        id: toastId,
        duration: 4000,
      }
    );
  };

  const showError = (
    message: string,
    description?: string,
    onRetry?: () => void,
    id?: string | number,
    type?: NotificationPreferenceType
  ) => {
    const toastId = id ?? Math.random().toString();
    if (!shouldNotify(type)) return toastId;
    return toast.error(
      <ErrorToast
        message={message}
        description={description}
        onRetry={onRetry}
        toastId={toastId}
        retryLabel={t("retry")}
        dismissLabel={t("dismiss")}
      />,
      { id: toastId, duration: Infinity }
    );
  };

  /**
   * Plain informational toast — no transaction chrome, no retry affordance.
   * Carried over from the module this one absorbed; used for passive notices
   * such as watchlist alerts.
   */
  const showInfo = (message: string, type?: NotificationPreferenceType) => {
    if (!shouldNotify(type)) return;
    return toast.info(
      <div role="status" aria-live="polite" className="font-medium text-foreground">
        {message}
      </div>
    );
  };

  const dismiss = (id?: string | number) => {
    toast.dismiss(id);
  };

  return {
    loading: showLoading,
    success: showSuccess,
    error: showError,
    info: showInfo,
    dismiss,
  };
}
