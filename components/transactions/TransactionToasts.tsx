"use client";

import { Loader2, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { StellarTxLink } from "@/components/ui/stellar-tx-link";
import { useSettingsStore } from "@/store/settingsStore";
import { toast } from "sonner";
import type { NotificationPreferenceType } from "@/hooks/useToast";
import { useTxAnnouncement } from "@/hooks/useTransaction";

export type NotificationVariant = "pending" | "success" | "error" | "warning";

export function PendingTransactionToast({ message }: { message: string }) {
  const t = useTranslations("transactionToast");
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 w-full"
      role="status" aria-live="polite"
      aria-label={`Transaction pending: ${message}`}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="shrink-0"
      >
        <Loader2 className="h-4 w-4 text-primary" />
      </motion.div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{message}</span>
        <span className="text-xs text-muted-foreground">{t("doNotClose")}</span>
      </div>
    </motion.div>
  );
}

export function SuccessTransactionToast({ message, txHash }: { message: string; txHash: string }) {
  const t = useTranslations("transactionToast");
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col gap-2 w-full"
      role="status" aria-live="polite"
      aria-label={`Transaction successful: ${message}`}
    >
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
          className="shrink-0 mt-0.5"
        >
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        </motion.div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{message}</span>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("txLabel")}</span>
            <StellarTxLink hash={txHash} chars={6} size="sm" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ErrorTransactionToast({
  message, details, onRetry, toastId,
}: {
  message: string;
  details?: string;
  onRetry?: () => void;
  toastId: string | number;
}) {
  const t = useTranslations("transactionToast");
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col gap-2 w-full"
      role="alert" aria-live="assertive"
      aria-label={`Transaction error: ${message}`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <AlertCircle className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-destructive">{message}</span>
          {details && <span className="text-xs text-muted-foreground line-clamp-2">{details}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {onRetry && (
          <button
            onClick={() => { toast.dismiss(toastId); onRetry(); }}
            className="rounded bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity"
            aria-label={t("retryLabel")}
          >
            {t("retryLabel")}
          </button>
        )}
        <button
          onClick={() => toast.dismiss(toastId)}
          className="rounded border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={t("dismissLabel")}
        >
          {t("dismissLabel")}
        </button>
      </div>
    </motion.div>
  );
}

export function TimeoutTransactionToast({ onRetry, toastId }: { onRetry: () => void; toastId: string | number }) {
  const t = useTranslations("transactionToast");
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col gap-2 w-full"
      role="alert" aria-live="assertive"
      aria-label={t("signatureTimeout")}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{t("signatureTimeout")}</span>
          <span className="text-xs text-muted-foreground">{t("signatureTimeoutDesc")}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => { toast.dismiss(toastId); onRetry(); }}
          className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          aria-label={t("retrySignatureLabel")}
        >
          {t("retrySignatureLabel")}
        </button>
        <button
          onClick={() => toast.dismiss(toastId)}
          className="rounded border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={t("dismissSignatureLabel")}
        >
          {t("dismissSignatureLabel")}
        </button>
      </div>
    </motion.div>
  );
}

export function WarningTransactionToast({ message, details }: { message: string; details?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 w-full"
      role="status" aria-live="polite"
      aria-label={`Warning: ${message}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{message}</span>
          {details && <span className="text-xs text-muted-foreground">{details}</span>}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Persistent, visually-hidden live regions announcing transaction lifecycle
 * changes (building/simulating/signing/submitting/polling/confirmed/failed)
 * to assistive tech (#441). Mount once, globally — see app/providers.tsx —
 * so it's a reliable single source of truth independent of the Sonner
 * toasts, which are visual-first and whose DOM nodes are too transient to
 * depend on for announcements.
 */
export function TransactionAnnouncer() {
  const { polite, assertive } = useTxAnnouncement();
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {polite ?? ""}
      </span>
      <span className="sr-only" role="alert" aria-live="assertive">
        {assertive ?? ""}
      </span>
    </>
  );
}

export function useTransactionToast() {
  const notificationPreferences = useSettingsStore((s) => s.notifications);

  const shouldNotify = (type?: NotificationPreferenceType) => {
    if (!type) return true;
    return notificationPreferences[type];
  };

  const showPending = (message: string, id: string | number = "tx-pending", type?: NotificationPreferenceType) => {
    if (!shouldNotify(type)) return id;
    return toast.loading(<PendingTransactionToast message={message} />, { id, duration: Infinity });
  };

  const showSuccess = (message: string, txHash: string, id?: string | number, type?: NotificationPreferenceType) => {
    const toastId = id ?? `tx-success-${txHash.slice(0, 8)}`;
    if (!shouldNotify(type)) return toastId;
    return toast.success(<SuccessTransactionToast message={message} txHash={txHash} />, { id: toastId, duration: 4000 });
  };

  const showError = (message: string, details?: string, onRetry?: () => void, id?: string | number, type?: NotificationPreferenceType) => {
    const toastId = id ?? `tx-error-${Date.now()}`;
    if (!shouldNotify(type)) return toastId;
    return toast.error(
      <ErrorTransactionToast message={message} details={details} onRetry={onRetry} toastId={toastId} />,
      { id: toastId, duration: Infinity }
    );
  };

  const showWarning = (message: string, details?: string, id?: string | number, type?: NotificationPreferenceType) => {
    const toastId = id ?? `tx-warning-${Date.now()}`;
    if (!shouldNotify(type)) return toastId;
    return toast.warning(<WarningTransactionToast message={message} details={details} />, { id: toastId, duration: 5000 });
  };

  const dismiss = (id?: string | number) => toast.dismiss(id);

  const update = (
    id: string | number,
    message: string,
    variant: "pending" | "success" | "error" | "warning",
    txHash?: string,
    options?: { duration?: number }
  ) => {
    let content;
    switch (variant) {
      case "pending":  content = <PendingTransactionToast message={message} />; break;
      case "success":  content = <SuccessTransactionToast message={message} txHash={txHash ?? ""} />; break;
      case "error":    content = <ErrorTransactionToast message={message} toastId={id} />; break;
      case "warning":  content = <WarningTransactionToast message={message} />; break;
    }
    toast.loading(content, { id, duration: options?.duration ?? Infinity });
  };

  return { showPending, showSuccess, showError, showWarning, dismiss, update };
}
