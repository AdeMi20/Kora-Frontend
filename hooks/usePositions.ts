"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getPositions } from "@/lib/stellar/contracts";
import { fetchPositions } from "@/services/invoiceService";
import { env } from "@/lib/env";
import { queryKeys } from "@/lib/queryKeys";
import { usePositionListingStore } from "@/store/positionListingStore";
import type { InvestorPosition } from "@/types/invoice";

export function usePositions(
  investorAddress?: string,
  opts?: { refetchInterval?: number }
) {
  const { reconcileListings } = usePositionListingStore();

  /**
   * After every successful positions fetch we reconcile the persisted listing
   * store. Any listing whose position ID is no longer in the investor's live
   * positions has been transferred away (stale). We remove it here and return
   * the stale set so the page can toast the user (#598).
   */
  const onSuccess = useCallback(
    (positions: InvestorPosition[]) => {
      const ownedIds = positions.map((p) => p.id);
      reconcileListings(ownedIds);
    },
    [reconcileListings]
  );

  return useQuery<InvestorPosition[]>({
    queryKey: queryKeys.invoices.positions(investorAddress ?? ""),
    queryFn: async () => {
      if (!investorAddress) return [];

      // Prefer service layer so mock mode returns rich invoice metadata
      // (jurisdiction / category / risk tier) for allocation breakdowns.
      if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
        const positions = await fetchPositions(investorAddress);
        const mapped = positions.map((p) => ({
          id: p.invoiceId,
          invoiceId: p.invoiceId,
          invoice: p.invoice,
          investedAmount: p.investedAmount,
          expectedReturn: p.expectedReturn,
          yieldEarned: p.yieldEarned ?? Math.max(0, p.expectedReturn - p.investedAmount),
          investedAt: p.investedAt ?? p.invoice.createdAt,
          status: p.status,
        }));
        onSuccess(mapped);
        return mapped;
      }

      const positions = await getPositions(investorAddress);
      const mapped = positions.map((p) => ({
        id: p.invoiceId,
        invoiceId: p.invoiceId,
        invoice: p.invoice,
        investedAmount: p.investedAmount,
        expectedReturn: p.expectedReturn,
        yieldEarned: p.yieldEarned,
        investedAt: p.investedAt,
        status: p.status,
      }));
      onSuccess(mapped);
      return mapped;
    },
    enabled: !!investorAddress,
    staleTime: 30_000,
    refetchInterval: opts?.refetchInterval,
  });
}

export default usePositions;
