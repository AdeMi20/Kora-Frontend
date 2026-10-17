"use client";

/**
 * useContractEvents — prefers Soroban/indexer event streaming with polling fallback.
 *
 * - Streams via EventSource (NEXT_PUBLIC_EVENTS_STREAM_URL) or a ≤2s RPC stream loop
 * - Falls back to 5s polling after repeated stream failures
 * - Pauses when network is offline (useNetworkStatus)
 * - Invalidates TanStack Query caches on each new event
 * - Stops on unmount
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  getContractEvents,
  subscribeContractEvents,
  EVENT_POLL_FALLBACK_INTERVAL_MS,
  EVENT_STREAM_INTERVAL_MS,
  type ContractEvent,
  type EventSubscriptionMode,
  type KoraEventType,
} from "@/lib/stellar/client";
import { queryKeys } from "@/lib/queryKeys";
import { useWalletStore } from "@/store/walletStore";
import { useInvoiceStore } from "@/store/invoiceStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { env } from "@/lib/env";
import { useFormatters } from "@/hooks/useFormatters";
import type { Invoice } from "@/types/invoice";

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES: KoraEventType[] = [
  "mint_invoice",
  "invoice_funded",
  "invoice_repaid",
  "invoice_cancelled",
];

// ─── Cache invalidation ───────────────────────────────────────────────────────

export function invalidateCachesForEvent(
  event: ContractEvent,
  queryClient: ReturnType<typeof useQueryClient>,
  updateInvoiceFunding: (id: string, newAmount: number) => void
) {
  const { invoicesByTokenId } = useInvoiceStore.getState();
  const invoice = Object.values(invoicesByTokenId).find(i => i.tokenId === event.tokenId) ||
    useInvoiceStore.getState().invoices.find(i => i.tokenId === event.tokenId);

  if (!invoice) {
    // Fallback to invalidation if we don't have the invoice in store
    queryClient.invalidateQueries({
      queryKey: queryKeys.invoices.detail(event.tokenId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    return;
  }

  switch (event.type) {
    case "mint_invoice":
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      if (event.tokenId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.invoices.detail(event.tokenId),
        });
      }
      break;

    case "invoice_funded": {
      const newTotalRaised = invoice.funding.totalRaised + event.amount;
      const totalRaised = Math.min(newTotalRaised, invoice.funding.targetAmount);
      const isFull = totalRaised >= invoice.funding.targetAmount;

      // Update the invoice store
      updateInvoiceFunding(invoice.id, newTotalRaised);

      // Update query cache for detail
      queryClient.setQueryData<any>(
        queryKeys.invoices.detail(event.tokenId),
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            status: isFull ? "fully_funded" : old.status,
            funding: {
              ...old.funding,
              totalRaised,
              fundingProgress: totalRaised / old.funding.targetAmount,
              remainingCapacity: old.funding.targetAmount - totalRaised,
              investorCount: old.funding.investorCount + 1,
            },
          };
        }
      );

      // Update any list queries (all invoices, filtered lists, etc.)
      queryClient.setQueriesData<any>(
        {
          queryKey: queryKeys.invoices.all,
          predicate: (query) => {
            // Match any invoice list query
            return Array.isArray(query.queryKey) &&
              query.queryKey[0] === "invoices";
          },
        },
        (old: any) => {
          if (!old) return old;
          // Check structure (could be array or object with invoices array)
          if (Array.isArray(old)) {
            return old.map((i: any) =>
              i.tokenId === event.tokenId
                ? {
                    ...i,
                    status: isFull ? "fully_funded" : i.status,
                    funding: {
                      ...i.funding,
                      totalRaised,
                      fundingProgress: totalRaised / i.funding.targetAmount,
                      remainingCapacity: i.funding.targetAmount - totalRaised,
                      investorCount: i.funding.investorCount + 1,
                    },
                  }
                : i
            );
          }
          if ("invoices" in old && Array.isArray(old.invoices)) {
            return {
              ...old,
              invoices: old.invoices.map((i: any) =>
                i.tokenId === event.tokenId
                  ? {
                      ...i,
                      status: isFull ? "fully_funded" : i.status,
                      funding: {
                        ...i.funding,
                        totalRaised,
                        fundingProgress: totalRaised / i.funding.targetAmount,
                        remainingCapacity: i.funding.targetAmount - totalRaised,
                        investorCount: i.funding.investorCount + 1,
                      },
                    }
                  : i
              ),
            };
          }
          return old;
        }
      );
      break;
    }

    case "invoice_repaid":
      queryClient.invalidateQueries({
        queryKey: queryKeys.invoices.detail(event.tokenId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "invoices" &&
          query.queryKey[1] === "positions",
      });
      break;

    case "invoice_cancelled":
      queryClient.invalidateQueries({
        queryKey: queryKeys.invoices.detail(event.tokenId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      break;
  }
}

// ─── Mock event generator (for development with mock data) ────────────────────

let _mockLedger = 1000;

function generateMockEvents(
  walletAddress: string,
  _startLedger: number
): { events: ContractEvent[]; latestLedger: number } {
  _mockLedger += 1;

  if (_mockLedger % 3 !== 0) {
    return { events: [], latestLedger: _mockLedger };
  }

  const type = EVENT_TYPES[_mockLedger % EVENT_TYPES.length];

  const event: ContractEvent = {
    id: `mock-event-${_mockLedger}`,
    ledger: _mockLedger,
    ledgerClosedAt: new Date().toISOString(),
    contractId: env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID,
    type,
    tokenId: String((_mockLedger % 5) + 1),
    amount: 5000,
    participantAddress: walletAddress,
    rawTopics: [type],
  };

  return { events: [event], latestLedger: _mockLedger };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseContractEventsOptions {
  /** Override the contract ID to listen on (defaults to MARKETPLACE_CONTRACT_ID) */
  contractId?: string;
  /** Override the stream interval in ms (defaults to 1_500) */
  streamIntervalMs?: number;
  /** Override the polling fallback interval in ms (defaults to 5_000) */
  pollIntervalMs?: number;
  /** Force polling-only mode (disables streaming) */
  forcePolling?: boolean;
  /** Disable subscription entirely */
  disabled?: boolean;
}

/**
 * Subscribes to Soroban contract events via streaming with polling fallback.
 *
 * Pauses automatically when the network is offline.
 */
export function useContractEvents(options: UseContractEventsOptions = {}) {
  const {
    contractId = env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID,
    streamIntervalMs = EVENT_STREAM_INTERVAL_MS,
    pollIntervalMs = EVENT_POLL_FALLBACK_INTERVAL_MS,
    forcePolling = false,
    disabled = false,
  } = options;

  const queryClient = useQueryClient();
  const { address: walletAddress } = useWalletStore();
  // All notification gates read the canonical settingsStore so a toggle flipped
  // anywhere in the app is respected here (funding/repayment milestones).
  const notifications = useSettingsStore((s) => s.notifications);
  const { fundingAlerts, repaymentAlerts } = notifications;
  const { health } = useNetworkStatus();
  const { updateInvoiceFunding } = useInvoiceStore();
  const { formatCurrency } = useFormatters();
  const t = useTranslations("contractEvents");

  const isOffline = health.overall === "down";
  const [mode, setMode] = useState<EventSubscriptionMode>(
    forcePolling ? "polling" : "stream"
  );

  const lastLedgerRef = useRef<number>(0);
  const processedEventIds = useRef<Set<string>>(new Set());

  const showEventToast = useCallback(
    (event: ContractEvent, addr: string) => {
      const isRelevant =
        event.participantAddress.toLowerCase() === addr.toLowerCase();

      if (!isRelevant) return;

      const amountStr = formatCurrency(event.amount, "USDC");

      switch (event.type) {
        case "invoice_funded":
          // Respect the fundingAlerts preference (settingsStore) — mirrors the
          // toggle in NotificationSettings under "Funding Alerts".
          if (!fundingAlerts) return;
          toast.success(
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-foreground">{t("invoiceFunded")}</span>
              <span className="text-xs text-muted-foreground">
                {t("invoiceFundedDesc", { amount: amountStr, tokenId: event.tokenId })}
              </span>
            </div>,
            { duration: 5000 }
          );
          break;

        case "invoice_repaid":
          // SME milestone — respect the repaymentAlerts preference.
          if (!repaymentAlerts) return;
          toast.success(
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-foreground">{t("invoiceRepaid")}</span>
              <span className="text-xs text-muted-foreground">
                {t("invoiceRepaidDesc", { tokenId: event.tokenId })}
              </span>
            </div>,
            { duration: 5000 }
          );
          break;

        case "invoice_cancelled":
          toast.info(
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-foreground">{t("invoiceCancelled")}</span>
              <span className="text-xs text-muted-foreground">
                {t("invoiceCancelledDesc", { tokenId: event.tokenId })}
              </span>
            </div>,
            { duration: 5000 }
          );
          break;
      }
    },
    [formatCurrency, t, fundingAlerts, repaymentAlerts]
  );

  const processEvents = useCallback(
    (events: ContractEvent[], latestLedger: number) => {
      if (latestLedger > lastLedgerRef.current) {
        lastLedgerRef.current = latestLedger;
      }

      const newEvents = events.filter(
        (e) => !processedEventIds.current.has(e.id)
      );

      for (const event of newEvents) {
        processedEventIds.current.add(event.id);
        invalidateCachesForEvent(event, queryClient, updateInvoiceFunding);

        if (walletAddress && notifications.invoiceFunded) {
          showEventToast(event, walletAddress);
        }
      }

      if (processedEventIds.current.size > 500) {
        const arr = Array.from(processedEventIds.current);
        processedEventIds.current = new Set(arr.slice(-250));
      }
    },
    [queryClient, walletAddress, notifications.invoiceFunded, updateInvoiceFunding, showEventToast]
  );

  const fetchOnce = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    try {
      const result = env.NEXT_PUBLIC_ENABLE_MOCK_DATA
        ? generateMockEvents(walletAddress ?? "", lastLedgerRef.current)
        : await getContractEvents({
            contractId,
            eventTypes: EVENT_TYPES,
            startLedger: lastLedgerRef.current,
          });

      processEvents(result.events, result.latestLedger);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[useContractEvents] Fetch error:", err);
      }
    }
  }, [contractId, processEvents, walletAddress]);

  // Streaming subscription (with automatic polling fallback inside subscribeContractEvents)
  useEffect(() => {
    if (disabled || isOffline || forcePolling) return;

    if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
      // Mock mode: emulate stream cadence without touching RPC
      setMode("stream");
      void fetchOnce();
      const id = setInterval(() => {
        void fetchOnce();
      }, streamIntervalMs);
      return () => clearInterval(id);
    }

    const subscription = subscribeContractEvents(
      {
        contractId,
        eventTypes: EVENT_TYPES,
        startLedger: lastLedgerRef.current,
        streamIntervalMs,
        pollIntervalMs,
      },
      {
        onEvents: ({ events, latestLedger }) => {
          processEvents(events, latestLedger);
        },
        onModeChange: setMode,
        onError: (err) => {
          if (process.env.NODE_ENV === "development") {
            console.warn("[useContractEvents] Stream error:", err);
          }
        },
      }
    );

    setMode(subscription.getMode());

    return () => subscription.unsubscribe();
  }, [
    disabled,
    isOffline,
    forcePolling,
    contractId,
    streamIntervalMs,
    pollIntervalMs,
    processEvents,
    fetchOnce,
  ]);

  // Explicit polling fallback path (forced or when offline resumes into forcePolling)
  useEffect(() => {
    if (disabled || isOffline || !forcePolling) return;

    setMode("polling");
    void fetchOnce();
    const id = setInterval(() => {
      void fetchOnce();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [disabled, isOffline, forcePolling, pollIntervalMs, fetchOnce]);

  // Re-fetch immediately when coming back online
  useEffect(() => {
    if (!isOffline && !disabled) {
      void fetchOnce();
    }
  }, [isOffline, disabled, fetchOnce]);

  // Re-fetch when tab becomes visible again
  useEffect(() => {
    if (disabled) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isOffline) {
        void fetchOnce();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [disabled, isOffline, fetchOnce]);

  return { mode, isOffline };
}
