"use client";

import { useEffect, useRef } from "react";
import type { Invoice } from "@/types";
import { useInvoiceStore } from "@/store";
import { useSettingsStore, type NotificationPrefs } from "@/store/settingsStore";
import { useToast } from "@/hooks/useToast";

type Snapshot = Pick<Invoice, "status"> & {
  fundingProgress: number;
  apr: number;
};

export function getAlertMessage(
  invoice: Invoice,
  previous: Snapshot | undefined,
  preferences: NotificationPrefs
): string | null {
  if (!previous) return null;
  if (preferences.status && previous.status !== invoice.status) {
    return `${invoice.metadata.invoiceNumber} is now ${invoice.status.replace(/_/g, " ")}.`;
  }
  if (preferences.fundingProgress && previous.fundingProgress !== invoice.funding.fundingProgress) {
    return `${invoice.metadata.invoiceNumber} funding reached ${Math.round(invoice.funding.fundingProgress * 100)}%.`;
  }
  if (preferences.apr && previous.apr !== invoice.terms.apr) {
    return `${invoice.metadata.invoiceNumber} APR changed to ${invoice.terms.apr}%.`;
  }
  return null;
}

function snapshot(invoice: Invoice): Snapshot {
  return {
    status: invoice.status,
    fundingProgress: invoice.funding.fundingProgress,
    apr: invoice.terms.apr,
  };
}

export function useWatchlistAlerts() {
  const invoices = useInvoiceStore((state) => state.invoices);
  const watchedInvoiceIds = useInvoiceStore((state) => state.watchedInvoiceIds);
  const preferences = useSettingsStore((state) => state.notifications);
  const previous = useRef<Record<string, Snapshot>>({});
  const { info } = useToast();

  useEffect(() => {
    const watched = new Set(watchedInvoiceIds);
    const next: Record<string, Snapshot> = {};

    invoices.forEach((invoice) => {
      if (!watched.has(invoice.id)) return;
      const current = snapshot(invoice);
      const old = previous.current[invoice.id];
      next[invoice.id] = current;
      if (!old) return;

      const message = getAlertMessage(invoice, old, preferences);
      if (message) info(message);
    });

    previous.current = next;
  }, [invoices, watchedInvoiceIds, preferences, info]);
}