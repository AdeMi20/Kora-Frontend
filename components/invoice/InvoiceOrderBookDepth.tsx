"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import { useShallow } from "zustand/react/shallow";
import { usePositionListingStore } from "@/store/positionListingStore";
import { formatCurrency, cn } from "@/lib/utils";
import type { PositionListingMeta } from "@/store/positionListingStore";

interface DepthRow {
  positionId: string;
  askPrice: number;
  impliedDiscount: number;
  listedAt: string;
  cumulativeVolume: number;
}

interface InvoiceOrderBookDepthProps {
  /** The on-chain token ID of the invoice to show depth for. */
  invoiceTokenId: string;
  /** Currency to display (e.g. "USDC"). */
  currency?: string;
  /** Total face value / expected return of a single position for context. */
  positionFaceValue?: number;
  className?: string;
}

/**
 * Aggregates all secondary-market ask listings for a specific invoice token
 * and renders them as a sorted order-book depth table.
 *
 * Listings are sorted ascending by ask price (cheapest first), giving buyers
 * immediate price-discovery. A cumulative volume column shows total capital
 * available at-or-below each price level.
 */
export function InvoiceOrderBookDepth({
  invoiceTokenId,
  currency = "USDC",
  positionFaceValue,
  className,
}: InvoiceOrderBookDepthProps) {
  const t = useTranslations("invoiceDetail.orderBook");
  // Subscribe to the listings themselves (not the stable getter) so the table
  // recomputes when a position is listed, re-priced or delisted. `useShallow`
  // keeps the filtered array referentially stable while this invoice's
  // listings are unchanged, so edits to other invoices don't re-render it.
  const listings: PositionListingMeta[] = usePositionListingStore(
    useShallow((state) =>
      Object.values(state.listings).filter(
        (l) => l.invoiceTokenId === invoiceTokenId
      )
    )
  );

  const depthRows: DepthRow[] = useMemo(() => {
    const sorted = [...listings].sort((a, b) => a.askPrice - b.askPrice);
    let cumulative = 0;
    return sorted.map((l) => {
      cumulative += l.askPrice;
      return {
        positionId: l.positionId,
        askPrice: l.askPrice,
        impliedDiscount: l.impliedDiscount,
        listedAt: l.listedAt,
        cumulativeVolume: cumulative,
      };
    });
  }, [listings]);

  /** Max cumulative volume for the depth bar width scaling. */
  const maxCumulative = depthRows.at(-1)?.cumulativeVolume ?? 1;

  return (
    <Card className={cn("border-zinc-800 bg-zinc-900/60", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpen className="h-4 w-4 text-primary" aria-hidden />
            {t("title")}
          </CardTitle>
          {depthRows.length > 0 && (
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/10 text-primary text-[10px]"
              aria-label={t("askCount", { count: depthRows.length })}
            >
              {t("askCount", { count: depthRows.length })}
            </Badge>
          )}
        </div>
        <p className="text-xs text-zinc-400">
          {t("description")}
        </p>
      </CardHeader>

      <CardContent className="p-0 pb-4">
        {depthRows.length === 0 ? (
          <div className="px-5 pb-2">
            <EmptyState
              title={t("empty.title")}
              description={t("empty.description")}
            />
          </div>
        ) : (
          <div
            role="table"
            aria-label={t("tableLabel")}
            className="w-full"
          >
            {/* Table header */}
            <div
              role="row"
              className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-3 border-b border-zinc-800 px-5 pb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500"
            >
              <span role="columnheader">{t("columns.askPrice")}</span>
              <span role="columnheader">{t("columns.discount")}</span>
              <span role="columnheader">{t("columns.cumulativeVolume")}</span>
              <span role="columnheader" className="sr-only">
                {t("columns.action")}
              </span>
            </div>

            {/* Rows */}
            {depthRows.map((row, idx) => {
              const depthBarWidth = `${Math.round((row.cumulativeVolume / maxCumulative) * 100)}%`;
              const isLowest = idx === 0;

              return (
                <div
                  key={row.positionId}
                  role="row"
                  className={cn(
                    "relative grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-x-3 px-5 py-2 text-xs transition-colors hover:bg-zinc-800/40",
                    isLowest && "bg-emerald-500/5"
                  )}
                >
                  {/* Depth visualisation bar */}
                  <span
                    role="progressbar"
                    aria-valuenow={
                      Math.round((row.cumulativeVolume / maxCumulative) * 100)
                    }
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("depthProgress", {
                      positionId: row.positionId,
                      value: formatCurrency(row.cumulativeVolume, currency),
                    })}
                    className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/8 transition-[width]"
                    style={{ width: depthBarWidth }}
                  />

                  <span role="cell" className="relative font-semibold text-white">
                    {formatCurrency(row.askPrice, currency)}
                    {isLowest && (
                      <span className="ml-1.5 text-[9px] text-emerald-400 font-normal">
                        {t("best")}
                      </span>
                    )}
                  </span>

                  <span
                    role="cell"
                    className={cn(
                      "relative",
                      row.impliedDiscount >= 0 ? "text-emerald-400" : "text-amber-400"
                    )}
                  >
                    {row.impliedDiscount >= 0 ? "−" : "+"}
                    {Math.abs(row.impliedDiscount * 100).toFixed(2)}%
                  </span>

                  <span role="cell" className="relative text-zinc-400">
                    {formatCurrency(row.cumulativeVolume, currency)}
                  </span>

                  <span role="cell" className="relative">
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-primary hover:text-primary/80"
                      aria-label={t("acquireAria", {
                        positionId: row.positionId,
                        price: formatCurrency(row.askPrice, currency),
                      })}
                    >
                      <Link href={`/secondary?highlight=${row.positionId}`}>
                        {t("acquire")}
                        <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                      </Link>
                    </Button>
                  </span>
                </div>
              );
            })}

            {/* Summary footer */}
            {positionFaceValue !== undefined && depthRows.length > 0 && (
              <div className="mt-2 border-t border-zinc-800 px-5 pt-2 text-[11px] text-zinc-500">
                {t("footer.faceValue")}{" "}
                <span className="font-medium text-zinc-300">
                  {formatCurrency(positionFaceValue, currency)}
                </span>
                {" · "}
                {t("footer.totalDepth")}{" "}
                <span className="font-medium text-zinc-300">
                  {formatCurrency(maxCumulative, currency)}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default InvoiceOrderBookDepth;
