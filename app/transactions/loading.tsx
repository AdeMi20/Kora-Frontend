import { Container } from "@/components/layout/Container";
import { Skeleton, StatCardSkeleton } from "@/components/ui/skeleton";

/**
 * Route loading UI for /transactions (#932).
 *
 * Mirrors app/transactions/page.tsx section for section — header, stat cards,
 * filter bar, then the stacked transaction rows — so the page drops in without
 * layout shift. Rows are cards at every breakpoint on the real page, so there
 * is no separate mobile table variant. Plain divs stand in for `Card` because
 * this is a server component and `Card` pulls in framer-motion.
 */
export default function TransactionsLoading() {
  return (
    <Container className="py-10">
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label="Loading transaction history"
      >
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-xl border border-border bg-card/60">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <Skeleton className="h-10 flex-1" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-14 rounded-lg" />
              ))}
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-16 rounded-lg" />
              ))}
            </div>
          </div>
        </div>

        {/* Transaction list */}
        <div className="rounded-xl border border-border bg-card/60">
          <div className="flex items-center justify-between p-6 pb-2">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                data-testid="tx-row-skeleton"
                className="flex items-start gap-4 rounded-xl border border-border bg-card/60 p-4"
              >
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-3/4" />
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Skeleton className="h-6 w-6 rounded-lg" />
                  <Skeleton className="h-6 w-6 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}
