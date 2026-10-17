"use client";

/**
 * PendingTxQueuePanel — lists queued signed-XDR drafts and lets the user
 * retry or discard them individually.
 *
 * Drafts are signed XDR envelopes stored in IndexedDB by lib/xdrDraftQueue.ts.
 * They contain NO private keys — only the signed transaction envelope that can
 * be safely submitted to the RPC when the network returns.
 *
 * Exponential backoff (issue #pwa-backoff):
 *   - Schedule: 1 s → 2 s → 4 s → 8 s → 16 s → 32 s (cap), per draft.
 *   - Maximum 5 attempts. After that the retry button is replaced with an
 *     "exhausted" state that offers Discard or Copy XDR.
 *   - A live countdown shows seconds until the next retry is allowed.
 *   - Backoff resets (attemptCount = 0, nextRetryAt = 0) on any success.
 *   - Attempt count and nextRetryAt are persisted to IndexedDB via
 *     updateDraftAttempts so the cooldown survives a page refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Clock,
  RefreshCw,
  Trash2,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  InboxIcon,
  Copy,
  Ban,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  listQueuedXdrDrafts,
  removeQueuedXdrDraft,
  updateDraftAttempts,
  type QueuedXdrDraft,
} from "@/lib/xdrDraftQueue";
import { submitTransaction } from "@/lib/stellar/client";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { cn } from "@/lib/utils";
import * as StellarSdk from "@stellar/stellar-sdk";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of submission attempts before the draft is exhausted. */
const MAX_ATTEMPTS = 5;

/**
 * Backoff delays in milliseconds indexed by attempt number (0-based).
 * After index 5 the schedule is capped at 32 s.
 */
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000] as const;

function backoffDelayMs(attemptCount: number): number {
  const idx = Math.min(attemptCount, BACKOFF_DELAYS_MS.length - 1);
  return BACKOFF_DELAYS_MS[idx];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DraftStatus = "idle" | "retrying" | "success" | "error" | "exhausted";

interface DraftState {
  draft: QueuedXdrDraft;
  status: DraftStatus;
  error?: string;
  /** In-memory attempt count (may be ahead of what's persisted mid-request). */
  attemptCount: number;
  /** Epoch ms — retry is blocked until this time is reached. */
  nextRetryAt: number;
  /** Seconds remaining in the backoff cooldown (re-computed by a ticker). */
  cooldownSecs: number;
}

// ─── Per-draft submit helper ──────────────────────────────────────────────────

async function submitDraft(draft: QueuedXdrDraft): Promise<void> {
  if (draft.signedXdr.startsWith("mock_")) {
    // Dev / mock mode — simulate a short delay then succeed
    await new Promise<void>((r) => setTimeout(r, 800));
    return;
  }

  StellarSdk.TransactionBuilder.fromXDR(
    draft.signedXdr,
    env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  );
  const result = await submitTransaction(draft.signedXdr);
  if (result.status === "ERROR") {
    throw new Error("Transaction submission failed");
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface PendingTxQueuePanelProps {
  /** Expose a callback whenever the visible queue count changes (used for badges). */
  onCountChange?: (count: number) => void;
  /** Extra class names applied to the outer container. */
  className?: string;
}

export function PendingTxQueuePanel({
  onCountChange,
  className,
}: PendingTxQueuePanelProps) {
  const t = useTranslations("pendingQueue");
  const { isOnline } = useNetworkStatus();

  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep stable reference to the callback so the effect doesn't re-subscribe
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  // ── Load queue from IndexedDB ───────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const items = await listQueuedXdrDrafts();
      setDrafts((prev) => {
        const prevById = new Map(prev.map((d) => [d.draft.id, d]));
        return items.map((draft) => {
          const existing = prevById.get(draft.id);
          if (existing) return { ...existing, draft };
          // Initialise backoff state from persisted values
          const attemptCount = draft.attempts ?? 0;
          const nextRetryAt  = draft.nextRetryAt ?? 0;
          const cooldownSecs = Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1_000));
          const status: DraftStatus =
            attemptCount >= MAX_ATTEMPTS
              ? "exhausted"
              : cooldownSecs > 0
                ? "error"   // still cooling down from last failure
                : "idle";
          return { draft, status, attemptCount, nextRetryAt, cooldownSecs };
        });
      });
      onCountChangeRef.current?.(items.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Cooldown ticker ─────────────────────────────────────────────────────────
  // A single 1-second interval updates cooldownSecs for every draft that is
  // still in its backoff window, then clears itself when none remain.

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setDrafts((prev) => {
        let anyActive = false;
        const next = prev.map((d) => {
          if (d.nextRetryAt <= now || d.status === "idle" || d.status === "retrying") {
            return d.cooldownSecs === 0 ? d : { ...d, cooldownSecs: 0 };
          }
          const secs = Math.max(0, Math.ceil((d.nextRetryAt - now) / 1_000));
          if (secs > 0) anyActive = true;
          return secs !== d.cooldownSecs ? { ...d, cooldownSecs: secs } : d;
        });
        if (!anyActive) clearInterval(intervalId);
        return next;
      });
    };

    const intervalId = setInterval(tick, 1_000);
    tick(); // run immediately so UI is correct on mount
    return () => clearInterval(intervalId);
  }, []);

  // ── Single-draft retry ──────────────────────────────────────────────────────

  const retryDraft = useCallback(
    async (id: string) => {
      const draftState = drafts.find((d) => d.draft.id === id);
      if (!draftState) return;

      // Guard: already exhausted
      if (draftState.attemptCount >= MAX_ATTEMPTS) return;

      // Guard: still in cooldown
      if (draftState.nextRetryAt > Date.now()) return;

      setDrafts((prev) =>
        prev.map((d) =>
          d.draft.id === id ? { ...d, status: "retrying", error: undefined } : d,
        ),
      );

      try {
        await submitDraft(draftState.draft);

        // ── Success path ───────────────────────────────────────────────────
        // Reset backoff, update IndexedDB, remove draft after animation delay
        await updateDraftAttempts(id, 0, 0);
        await removeQueuedXdrDraft(id);

        setDrafts((prev) =>
          prev.map((d) => (d.draft.id === id ? { ...d, status: "success" } : d)),
        );

        setTimeout(() => {
          setDrafts((prev) => {
            const next = prev.filter((d) => d.draft.id !== id);
            onCountChangeRef.current?.(next.length);
            return next;
          });
        }, 1_200);

        toast.success(t("retrySuccess"));
      } catch (err) {
        // ── Failure path ───────────────────────────────────────────────────
        const newAttemptCount = draftState.attemptCount + 1;
        const delayMs         = backoffDelayMs(newAttemptCount);
        const newNextRetryAt  = Date.now() + delayMs;
        const cooldownSecs    = Math.ceil(delayMs / 1_000);

        // Persist updated attempt info so it survives a reload
        await updateDraftAttempts(id, newAttemptCount, newNextRetryAt);

        const isExhausted = newAttemptCount >= MAX_ATTEMPTS;
        const error = err instanceof Error ? err.message : t("retryFailed");

        setDrafts((prev) =>
          prev.map((d) =>
            d.draft.id === id
              ? {
                  ...d,
                  status:       isExhausted ? "exhausted" : "error",
                  error,
                  attemptCount: newAttemptCount,
                  nextRetryAt:  isExhausted ? 0 : newNextRetryAt,
                  cooldownSecs: isExhausted ? 0 : cooldownSecs,
                }
              : d,
          ),
        );

        if (isExhausted) {
          toast.error(t("retryExhausted"), { description: t("retryExhaustedDesc") });
        } else {
          toast.error(t("retryFailed"), { description: error });
        }
      }
    },
    [drafts, t],
  );

  // ── Single-draft remove ─────────────────────────────────────────────────────

  const removeDraft = useCallback(
    async (id: string) => {
      await removeQueuedXdrDraft(id);
      setDrafts((prev) => {
        const next = prev.filter((d) => d.draft.id !== id);
        onCountChangeRef.current?.(next.length);
        return next;
      });
      toast.info(t("removed"));
    },
    [t],
  );

  // ── Copy XDR to clipboard ───────────────────────────────────────────────────

  const copyXdr = useCallback(
    async (draft: QueuedXdrDraft) => {
      try {
        await navigator.clipboard.writeText(draft.signedXdr);
        toast.success(t("xdrCopied"));
      } catch {
        toast.error(t("xdrCopyFailed"));
      }
    },
    [t],
  );

  // ── Retry all (only when online) ────────────────────────────────────────────

  const retryAll = useCallback(async () => {
    const retryable = drafts.filter(
      (d) =>
        (d.status === "idle" || d.status === "error") &&
        d.attemptCount < MAX_ATTEMPTS &&
        d.nextRetryAt <= Date.now(),
    );
    await Promise.allSettled(retryable.map((d) => retryDraft(d.draft.id)));
  }, [drafts, retryDraft]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={cn("animate-pulse space-y-2", className)} aria-busy="true">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-zinc-800/60" />
        ))}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center",
          className,
        )}
        data-testid="pending-queue-empty"
      >
        <InboxIcon className="h-8 w-8 text-zinc-600" aria-hidden="true" />
        <p className="text-sm text-zinc-400">{t("emptyState")}</p>
      </div>
    );
  }

  const retryableCount = drafts.filter(
    (d) =>
      (d.status === "idle" || d.status === "error") &&
      d.attemptCount < MAX_ATTEMPTS &&
      d.nextRetryAt <= Date.now(),
  ).length;

  return (
    <div className={cn("space-y-3", className)} data-testid="pending-queue-panel">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          {t("title", { count: drafts.length })}
        </p>

        {isOnline && retryableCount > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={retryAll}
            className="h-6 gap-1 px-2 text-xs"
            data-testid="retry-all-button"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {t("retryAll")}
          </Button>
        )}
      </div>

      {/* Draft list */}
      <ul className="space-y-2" aria-label={t("listAriaLabel")}>
        {drafts.map(({ draft, status, error, attemptCount, cooldownSecs }) => (
          <li
            key={draft.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
              status === "success"
                ? "border-emerald-800/60 bg-emerald-950/30"
                : status === "error" || status === "exhausted"
                  ? "border-red-800/60 bg-red-950/20"
                  : "border-zinc-800 bg-zinc-900/40",
            )}
            data-testid="queue-draft-item"
            data-draft-id={draft.id}
          >
            {/* Status icon */}
            <div className="mt-0.5 shrink-0">
              {status === "retrying" ? (
                <RefreshCw
                  className="h-4 w-4 animate-spin text-amber-400"
                  aria-label={t("statusRetrying")}
                />
              ) : status === "success" ? (
                <CheckCircle2
                  className="h-4 w-4 text-emerald-400"
                  aria-label={t("statusSuccess")}
                />
              ) : status === "exhausted" ? (
                <Ban
                  className="h-4 w-4 text-red-400"
                  aria-label={t("statusExhausted")}
                />
              ) : status === "error" ? (
                <AlertCircle
                  className="h-4 w-4 text-red-400"
                  aria-label={t("statusError")}
                />
              ) : (
                <Clock
                  className="h-4 w-4 text-zinc-500"
                  aria-label={t("statusPending")}
                />
              )}
            </div>

            {/* Body */}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate font-medium text-zinc-200">
                {typeof draft.meta.type === "string"
                  ? t("txType", { type: draft.meta.type })
                  : t("unknownTx")}
              </p>

              {typeof draft.meta.invoiceId === "string" && (
                <p className="truncate text-xs text-zinc-500">
                  {t("invoiceLabel", { id: draft.meta.invoiceId })}
                </p>
              )}

              <p className="text-xs text-zinc-500">
                {t("queuedAt", {
                  time: formatDistanceToNow(draft.queuedAt, { addSuffix: true }),
                })}
                {draft.attempts > 0 && (
                  <span className="ml-1.5 text-zinc-600">
                    · {t("attempts", { count: draft.attempts })}
                  </span>
                )}
              </p>

              {/* Backoff countdown */}
              {(status === "error") && cooldownSecs > 0 && (
                <p className="text-xs text-amber-500" data-testid="backoff-countdown">
                  {t("retryIn", { seconds: cooldownSecs })}
                </p>
              )}

              {/* Exhausted state message */}
              {status === "exhausted" && (
                <p className="text-xs text-red-400" data-testid="exhausted-message">
                  {t("retryExhaustedDesc")}
                </p>
              )}

              {error && status === "error" && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>

            {/* Actions */}
            {status !== "success" && (
              <div className="flex shrink-0 gap-1.5">
                {/* Exhausted: offer copy XDR only */}
                {status === "exhausted" ? (
                  <button
                    type="button"
                    onClick={() => void copyXdr(draft)}
                    className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    aria-label={t("copyXdrAriaLabel")}
                    data-testid="copy-xdr-button"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    {/* Retry button — hidden while offline, in cooldown, or exhausted */}
                    {isOnline &&
                      (status === "idle" || status === "error") &&
                      cooldownSecs === 0 &&
                      attemptCount < MAX_ATTEMPTS && (
                        <button
                          type="button"
                          onClick={() => void retryDraft(draft.id)}
                          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                          aria-label={t("retryAriaLabel")}
                          data-testid="retry-draft-button"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}

                    {/* Offline waiting indicator */}
                    {!isOnline && status === "idle" && (
                      <span
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-500"
                        aria-label={t("offlineAriaLabel")}
                      >
                        <WifiOff className="h-3 w-3" aria-hidden="true" />
                        {t("waitingOnline")}
                      </span>
                    )}
                  </>
                )}

                {/* Discard button — always present except on success/retrying */}
                <button
                  type="button"
                  onClick={() => void removeDraft(draft.id)}
                  disabled={status === "retrying"}
                  className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-40"
                  aria-label={t("removeAriaLabel")}
                  data-testid="remove-draft-button"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
