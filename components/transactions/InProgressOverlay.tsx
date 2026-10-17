"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Clock,
  Smartphone,
  Cpu,
  Globe,
  RefreshCw,
  PlusCircle,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useWalletStore } from "@/store/walletStore";
import { useTransactionStore } from "@/store/transactionStore";
import {
  useSecondaryEscrowFlow,
  useTransaction,
  getProviderSigningConfig,
} from "@/hooks/useTransaction";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * InProgressOverlay
 * Full-screen accessible modal overlay shown during wallet signing step,
 * hardware wallet extended timeouts, and secondary market escrow flows.
 */
export function InProgressOverlay() {
  const t = useTranslations("transaction");
  const { txState, setTxState, resetTxState } = useUIStore();
  const provider = useWalletStore((s) => s.provider);
  const { escrowState, retryEscrow, resetEscrow } = useSecondaryEscrowFlow();
  const { cancel, extendTimeout } = useTransaction();

  const isSigningStage = txState.status === "signing";
  const isTimeoutStage = txState.status === "timeout";
  const isEscrowActive = escrowState.step !== "idle";
  const isOpen = isSigningStage || isTimeoutStage || isEscrowActive;

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Time remaining calculation
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const signingConfig = getProviderSigningConfig(
    ("provider" in txState && txState.provider) || provider
  );

  const getAnnouncementText = () => {
    if (isEscrowActive) {
      if (escrowState.errorMessage) {
        return `Escrow transaction failed: ${escrowState.errorMessage}`;
      }
      if (escrowState.step === "settled") {
        return "Escrow Settlement Complete";
      }
      if (escrowState.step === "buyer_funding") {
        return "Escrow step 1: Buyer Deposit in progress";
      }
      if (escrowState.step === "seller_transferring") {
        return "Escrow step 2: Seller Position Transfer in progress";
      }
      return "Escrow transaction in progress";
    }
    if (isTimeoutStage) {
      return "Transaction signing request timed out. Please extend time, retry, or cancel safely.";
    }
    if (isSigningStage) {
      return `Waiting for transaction signature from ${signingConfig.providerName || "your wallet"}. Please approve the request on your device.`;
    }
    if (txState.status === "submitting") {
      return "Submitting transaction to the network...";
    }
    if (txState.status === "confirmed") {
      return "Transaction confirmed";
    }
    if (txState.status === "failed") {
      return "Transaction failed";
    }
    if (txState.status && txState.status !== "idle") {
      return `Transaction status: ${txState.status}`;
    }
    return "";
  };

  const announcementText = getAnnouncementText();

  useEffect(() => {
    if (!isSigningStage) return;

    const startedAt = ("startedAt" in txState && txState.startedAt) || Date.now();
    const timeoutMs =
      ("timeoutMs" in txState && txState.timeoutMs) || signingConfig.timeoutMs || 60_000;
    const deadline = startedAt + timeoutMs;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isSigningStage, txState, signingConfig]);

  const handleCancel = () => {
    cancel();
    resetEscrow();
    resetTxState();
  };

  const handleEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  const tips =
    ("tips" in txState && txState.tips && txState.tips.length > 0)
      ? txState.tips
      : signingConfig.tips;

  const renderEscrowSteps = () => {
    const steps = [
      {
        id: "buyer_funding",
        label: "Buyer Deposit",
        desc: "Escrow funds locked in smart contract",
        active: escrowState.step === "buyer_funding",
        success:
          escrowState.step !== "idle" &&
          escrowState.step !== "buyer_funding" &&
          !(escrowState.errorStep === "buyer_funding"),
        failed: escrowState.errorStep === "buyer_funding",
      },
      {
        id: "seller_transferring",
        label: "Seller Position Transfer",
        desc: "Seller signs over yield rights",
        active: escrowState.step === "seller_transferring",
        success:
          escrowState.step === "seller_transferred" || escrowState.step === "settled",
        failed: escrowState.errorStep === "seller_transferring",
      },
      {
        id: "settled",
        label: "Escrow Settlement Complete",
        desc: "Yield rights transferred to Buyer",
        active: false,
        success: escrowState.step === "settled",
        failed: false,
      },
    ];

    return (
      <div className="w-full space-y-4 my-2">
        {steps.map((s, index) => (
          <div
            key={s.id}
            className={cn(
              "flex gap-3 items-start p-3 rounded-lg border transition-colors",
              s.active
                ? "bg-primary/5 border-primary/20"
                : s.failed
                ? "bg-destructive/5 border-destructive/20"
                : s.success
                ? "bg-success/5 border-success/15"
                : "bg-muted/10 border-border/30 opacity-60"
            )}
          >
            <div className="mt-0.5">
              {s.active ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin text-primary" />
              ) : s.failed ? (
                <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
              ) : s.success ? (
                <CheckCircle2 className="h-4.5 w-4.5 text-success" />
              ) : (
                <div className="h-4.5 w-4.5 rounded-full border border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500 font-bold">
                  {index + 1}
                </div>
              )}
            </div>
            <div className="space-y-0.5">
              <p
                className={cn(
                  "text-xs font-semibold",
                  s.failed ? "text-destructive" : "text-zinc-200"
                )}
              >
                {s.label}
              </p>
              <p className="text-[10px] text-muted-foreground">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Retry ledger - shows attempt history for failed steps
  const renderRetryLedger = () => {
    const { escrowState: { attemptHistory } } = useTransactionStore();
    if (!attemptHistory || attemptHistory.length === 0) return null;

    return (
      <div className="w-full space-y-2 pt-2 border-t border-border/30">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Retry History
          </p>
          <span className="text-xs text-muted-foreground">
            {attemptHistory.length} attempt{attemptHistory.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {attemptHistory
            .slice()
            .reverse()
            .map((attempt, index) => (
              <div
                key={`${attempt.step}-${attempt.attemptNumber}`}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/30 bg-muted/20"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-medium text-zinc-300">
                      {attempt.step === "buyer_funding" ? "Buyer Funding" : "Seller Transfer"}
                    </span>
                    <span className="text-muted-foreground">Attempt #{attempt.attemptNumber}</span>
                    {attempt.success ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 text-success border border-success/20">
                        <span className="h-2.5 w-2.5 rounded-full bg-success" />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20">
                        Failed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{formatDate(attempt.timestamp, "HH:mm:ss")}</span>
                    {attempt.txHash && (
                      <>
                        <span>·</span>
                        <span className="font-mono text-[9px]">{attempt.txHash.slice(0, 8)}...</span>
                      </>
                    )}
                  </div>
                </div>
                {attempt.errorMessage && (
                  <div className="mt-1 text-[10px] text-destructive/80 break-words">
                    {attempt.errorMessage}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="overlay"
          ref={dialogRef}
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onKeyDown={handleEscape}
          role="dialog"
          aria-modal="true"
          aria-labelledby="overlay-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm focus:outline-none"
        >
          {/* Accessible Live Region for Screen Readers */}
          <div
            role="status"
            aria-live="assertive"
            aria-atomic="true"
            className="sr-only"
            data-testid="tx-overlay-announcement"
          >
            {announcementText}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative flex flex-col items-center justify-center gap-5 rounded-2xl bg-card border border-border p-7 shadow-2xl max-w-sm w-full mx-4"
          >
            {isEscrowActive ? (
              // Escrow Flow Content
              <>
                <div className="flex flex-col items-center gap-2 text-center w-full">
                  <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-kora-muted text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h2 id="overlay-title" className="text-lg font-semibold text-zinc-200">
                    Escrow Settlement
                  </h2>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Secondary trade transaction in progress
                  </p>
                </div>

                {renderEscrowSteps()}

                {escrowState.errorMessage && (
                  <div className="w-full rounded-lg bg-destructive/10 border border-destructive/20 p-3 space-y-1">
                    <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> Transaction Failed
                    </p>
                    <p className="text-[10px] text-muted-foreground break-words leading-relaxed">
                      {escrowState.errorMessage}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={cn(
                      "flex-1 px-4 py-2.5 rounded-lg font-medium text-xs transition-all",
                      "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      "border border-border/50 hover:border-border"
                    )}
                  >
                    {escrowState.step === "settled" ? "Close" : "Cancel"}
                  </button>

                  {escrowState.errorStep && (
                    <button
                      type="button"
                      onClick={() => {
                        const ctx = escrowState.currentContext;
                        if (ctx) {
                          retryEscrow(ctx.positionId, ctx.buyerAddress, ctx.sellerAddress, ctx.amount);
                        }
                      }}
                      className={cn(
                        "flex-1 px-4 py-2.5 rounded-lg font-medium text-xs transition-all",
                        "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/10",
                        "flex items-center justify-center gap-1"
                      )}
                    >
                      Retry Step <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {renderRetryLedger()}
              </>
            ) : isTimeoutStage ? (
              // Actionable Timeout Recovery View (#579)
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                  <Clock className="h-6 w-6" />
                </div>

                <div className="flex flex-col items-center gap-1.5 text-center">
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px]"
                  >
                    {signingConfig.providerName}
                  </Badge>
                  <h2 id="overlay-title" className="text-lg font-semibold text-foreground">
                    Signing Request Timed Out
                  </h2>
                  <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                    The wallet did not respond in time. Hardware devices or mobile wallets often require unlocking the app or confirming settings.
                  </p>
                </div>

                <div className="w-full rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground text-xs">Troubleshooting tips:</p>
                  <ul className="space-y-1 list-disc list-inside text-[11px]">
                    {tips.map((tip, idx) => (
                      <li key={idx}>{tip}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-2 w-full pt-1">
                  <button
                    type="button"
                    onClick={() => extendTimeout(60_000)}
                    className={cn(
                      "w-full px-4 py-2.5 rounded-lg font-medium text-xs transition-all",
                      "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md",
                      "flex items-center justify-center gap-1.5"
                    )}
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    Extend Time (+60s) & Keep Waiting
                  </button>

                  <button
                    type="button"
                    onClick={handleCancel}
                    aria-label={t("cancelSigningSafely")}
                    className={cn(
                      "w-full px-4 py-2 rounded-lg font-medium text-xs transition-all",
                      "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      "border border-border/50"
                    )}
                  >
                    Cancel Safely
                  </button>
                </div>
              </>
            ) : (
              // Standard Transaction Signing Overlay Content with Hardware/Mobile UX
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="relative"
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-primary/20 to-transparent blur-lg" />
                  <Loader2 className="h-12 w-12 text-primary relative z-10" />
                </motion.div>

                <div className="flex flex-col items-center gap-1.5 text-center">
                  <div className="flex items-center gap-1.5">
                    {signingConfig.category === "hardware" ? (
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                    ) : signingConfig.category === "mobile" ? (
                      <Smartphone className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Globe className="h-3.5 w-3.5 text-primary" />
                    )}
                    <Badge variant="outline" className="text-[10px] py-0">
                      {signingConfig.providerName}
                    </Badge>
                  </div>

                  <h2 id="overlay-title" className="text-lg font-semibold text-foreground">
                    Waiting for Signature
                  </h2>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Complete the signature request on your wallet or device
                  </p>
                </div>

                {/* Progress & Countdown */}
                <div className="w-full space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Time remaining
                    </span>
                    <span className="font-mono font-medium text-foreground">
                      {secondsRemaining}s
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        secondsRemaining > 20
                          ? "bg-primary"
                          : secondsRemaining > 10
                          ? "bg-amber-500"
                          : "bg-destructive"
                      )}
                      style={{
                        width: `${Math.min(
                          100,
                          (secondsRemaining / (signingConfig.timeoutMs / 1000)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Provider-specific tips */}
                <div className="w-full rounded-lg bg-muted/50 border border-border/50 p-3 space-y-1.5">
                  <p className="text-xs font-medium text-foreground">
                    {signingConfig.category === "hardware"
                      ? "Hardware Wallet Guidance:"
                      : signingConfig.category === "mobile"
                      ? "Mobile Signer Guidance:"
                      : "Signing Guidance:"}
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside text-[11px]">
                    {tips.map((tip, idx) => (
                      <li key={idx}>{tip}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => extendTimeout(60_000)}
                    aria-label={t("addExtraTime")}
                    className={cn(
                      "flex-1 px-3 py-2 rounded-lg font-medium text-xs transition-all",
                      "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                      "border border-border/50 flex items-center justify-center gap-1"
                    )}
                  >
                    <PlusCircle className="h-3 w-3" /> +60s Time
                  </button>

                  <button
                    type="button"
                    onClick={handleCancel}
                    aria-label={t("cancelTransactionSigningSafely")}
                    className={cn(
                      "flex-1 px-3 py-2 rounded-lg font-medium text-xs transition-all",
                      "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      "border border-border/50 hover:border-border",
                      "focus:outline-none focus:ring-2 focus:ring-primary/50"
                    )}
                  >
                    Cancel Safely
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
