"use client";

/**
 * BatchTxQueuePanel — Issue #730
 *
 * Displays the live state of a batch transaction queue alongside the
 * BatchActionToolbar. Each queued item (cancel/repay) shows its current
 * status — pending, processing, success, or failed — with accessible
 * live-region announcements.
 *
 * Integrates with the `createBatchTxQueue()` factory via a subscription
 * snapshot; the parent page owns the queue ref and passes snapshots down.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { BatchQueueItem, BatchQueueSnapshot, BatchItemStatus } from "@/lib/batch/txQueue";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BatchTxQueuePanelProps {
  /** Current snapshot from createBatchTxQueue().subscribe() */
  snapshot: BatchQueueSnapshot;
  /** Called when user clicks "Retry Failed" */
  onResumeFailed?: () => void;
  /** Called when user dismisses a fully completed (or all-failed) queue */
  onDismiss?: () => void;
  /** Additional class names for the panel root */
  className?: string;
}

// ── Status helpers ────────────────────────────────────────────────────────────

function statusIcon(status: BatchItemStatus) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />;
    case "processing":
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" aria-hidden="true" />;
    case "skipped":
      return <Clock className="h-4 w-4 text-zinc-500 shrink-0" aria-hidden="true" />;
    default:
      // pending
      return <Clock className="h-4 w-4 text-zinc-500 shrink-0" aria-hidden="true" />;
  }
}

function statusLabel(status: BatchItemStatus): string {
  switch (status) {
    case "success":    return "Success";
    case "failed":     return "Failed";
    case "processing": return "Processing…";
    case "skipped":    return "Skipped";
    default:           return "Pending";
  }
}

function statusRowClass(status: BatchItemStatus): string {
  switch (status) {
    case "success":    return "bg-emerald-950/30 border-emerald-800/30";
    case "failed":     return "bg-destructive/5 border-destructive/20";
    case "processing": return "bg-primary/5 border-primary/20";
    default:           return "bg-zinc-900/40 border-zinc-800/40";
  }
}

function actionIcon(action: BatchQueueItem["action"]) {
  return action === "repay"
    ? <Banknote className="h-3 w-3 text-zinc-500 shrink-0" aria-hidden="true" />
    : <XCircle  className="h-3 w-3 text-zinc-500 shrink-0" aria-hidden="true" />;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Batch transaction progress"
    >
      <motion.div
        className="absolute inset-y-0 left-0 bg-primary"
        initial={{ width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BatchTxQueuePanel({
  snapshot,
  onResumeFailed,
  onDismiss,
  className,
}: BatchTxQueuePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const { items, isRunning, processed, successCount, failedCount } = snapshot;
  const total = items.length;
  const percent = total > 0 ? (processed / total) * 100 : 0;

  const isDone = !isRunning && total > 0 && processed === total;
  const hasFailures = failedCount > 0;
  const allSuccess = isDone && failedCount === 0;

  // Accessible live-region: announce status changes
  const [announcement, setAnnouncement] = useState("");
  const liveRef = useRef<HTMLDivElement>(null);
  const prevProcessed = useRef(processed);
  const prevIsDone = useRef(isDone);
  const prevFailedCount = useRef(failedCount);

  useEffect(() => {
    if (isDone && !prevIsDone.current) {
      setAnnouncement(
        failedCount > 0
          ? `Batch complete. ${successCount} of ${total} succeeded, ${failedCount} failed.`
          : `Batch complete. All ${total} operations succeeded.`,
      );
    } else if (failedCount > prevFailedCount.current) {
      setAnnouncement(
        `Batch operation failed. ${failedCount} of ${total} failed so far.`,
      );
    } else if (processed !== prevProcessed.current) {
      setAnnouncement(
        `Batch progress: ${processed} of ${total} processed.`,
      );
    }
    prevProcessed.current = processed;
    prevIsDone.current = isDone;
    prevFailedCount.current = failedCount;
  }, [processed, isDone, failedCount, successCount, total]);

  // Don't render when there's nothing to show
  if (total === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-md overflow-hidden",
        className,
      )}
      data-testid="batch-tx-queue-panel"
    >
      {/* Accessible live region for status announcements */}
      <div
        ref={liveRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="batch-panel-live-region"
      >
        {announcement}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && (
            <Loader2
              className="h-4 w-4 text-primary animate-spin shrink-0"
              aria-hidden="true"
            />
          )}
          {isDone && allSuccess && (
            <CheckCircle2
              className="h-4 w-4 text-emerald-400 shrink-0"
              aria-hidden="true"
            />
          )}
          {isDone && hasFailures && (
            <XCircle
              className="h-4 w-4 text-destructive shrink-0"
              aria-hidden="true"
            />
          )}

          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {isRunning
                ? "Processing Batch…"
                : isDone
                  ? allSuccess
                    ? "Batch Complete"
                    : `Batch Done — ${failedCount} failed`
                  : "Queued Batch Operations"}
            </p>
            <p className="text-xs text-zinc-500">
              {successCount} / {total} succeeded
              {hasFailures ? ` · ${failedCount} failed` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDone && hasFailures && onResumeFailed && (
            <Button
              variant="outline"
              size="sm"
              onClick={onResumeFailed}
              className="h-7 gap-1 border-zinc-700 text-xs"
              data-testid="batch-panel-retry-btn"
            >
              <RotateCcw className="h-3 w-3" />
              Retry {failedCount} failed
            </Button>
          )}
          {isDone && onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
              data-testid="batch-panel-dismiss-btn"
            >
              Dismiss
            </Button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center justify-center h-6 w-6 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            aria-label={collapsed ? "Expand queue panel" : "Collapse queue panel"}
            data-testid="batch-panel-collapse-btn"
          >
            {collapsed
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronUp   className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Progress bar — always visible */}
      {(isRunning || isDone) && (
        <div className="px-4 pt-2 pb-1">
          <ProgressBar percent={percent} />
          {isRunning && (
            <p className="mt-1 text-[11px] text-zinc-600">
              {Math.round(percent)}% complete
            </p>
          )}
        </div>
      )}

      {/* Live status items — collapsible */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul
            key="item-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="divide-y divide-zinc-800/40 overflow-hidden"
            data-testid="batch-panel-item-list"
          >
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-2 px-4 py-2 border-l-2",
                  statusRowClass(item.status),
                )}
                data-testid={`batch-item-${item.id}`}
                data-status={item.status}
              >
                {statusIcon(item.status)}
                {actionIcon(item.action)}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="text-xs text-zinc-300 truncate block">
                    {item.label}
                  </span>
                  {/* Show tx hash prefix for successfully processed items */}
                  {item.status === "success" && item.txHash && (
                    <span className="text-[11px] text-zinc-500 font-mono block truncate">
                      {item.txHash.slice(0, 12)}…
                    </span>
                  )}
                  {/* Show error message for failed items */}
                  {item.status === "failed" && item.error && (
                    <span className="text-[11px] text-destructive block truncate">
                      {item.error}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-zinc-500 shrink-0">
                  {statusLabel(item.status)}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
