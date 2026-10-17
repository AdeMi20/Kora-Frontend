"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  History,
  Download,
  Trash2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Search,
  X,
  ArrowUpRight,
  Coins,
  FileText,
  RefreshCw,
  Gift,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Container } from "@/components/layout/Container";
import { useWallet } from "@/hooks/useWallet";
import { useUIStore, useTransactionStore } from "@/store";
import type { TxRecord, TxType } from "@/store/transactionStore";
import { cn, exportCsv } from "@/lib/utils";
import { useFormatters } from "@/hooks/useFormatters";
import { StellarTxLink } from "@/components/ui/stellar-tx-link";
import { safeStellarTxUrl } from "@/lib/security";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useTranslations } from "next-intl";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Presentation only. The human-readable label lives in the `transactions`
// message namespace under `types.<type>Label` — keeping it out of this table
// is what stops a new transaction type from shipping with an English-only
// name, which is how the hardcoded labels got here in the first place.
const TX_TYPE_CONFIG: Record<
  TxType,
  { icon: React.ElementType; colorClass: string; bgClass: string }
> = {
  mint: {
    icon: FileText,
    colorClass: "text-blue-400",
    bgClass: "bg-blue-400/10",
  },
  fund: {
    icon: Coins,
    colorClass: "text-emerald-400",
    bgClass: "bg-emerald-400/10",
  },
  repay: {
    icon: RefreshCw,
    colorClass: "text-cyan-400",
    bgClass: "bg-cyan-400/10",
  },
  claim: {
    icon: Gift,
    colorClass: "text-yellow-400",
    bgClass: "bg-yellow-400/10",
  },
};

// Filter values in display order. Labels are resolved per-render from
// `transactions.types.*` so the dropdown follows the active locale.
const TYPE_FILTER_VALUES: (TxType | "all")[] = ["all", "mint", "fund", "repay", "claim"];

const STATUS_FILTER_VALUES = ["all", "confirmed", "failed"] as const;

function TxTypeIcon({ type }: { type: TxType }) {
  const config = TX_TYPE_CONFIG[type];
  const Icon = config.icon;
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        config.bgClass
      )}
    >
      <Icon className={cn("h-4 w-4", config.colorClass)} aria-hidden />
    </div>
  );
}

function StatusBadge({ status }: { status: TxRecord["status"] }) {
  const t = useTranslations("transactions");

  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {t("statusLabels.confirmed")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">
      <XCircle className="h-3 w-3" aria-hidden />
      {t("statusLabels.failed")}
    </span>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

// Replaced by shared EmptyState component in components/ui/EmptyState.tsx

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TxRow({ tx, onRemove }: { tx: TxRecord; onRemove: (hash: string) => void }) {
  const config = TX_TYPE_CONFIG[tx.type];
  const { formatDate, formatCurrency } = useFormatters();
  const t = useTranslations("transactions");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-start gap-4 rounded-xl border border-border bg-card/60 p-4 transition-colors hover:bg-card"
    >
      <TxTypeIcon type={tx.type} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm font-semibold", config.colorClass)}>
            {t(`types.${tx.type}Label` as Parameters<typeof t>[0])}
          </span>
          <StatusBadge status={tx.status} />
          {tx.invoiceNumber && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {tx.invoiceNumber}
            </span>
          )}
        </div>

        {tx.description && (
          <p className="text-xs text-muted-foreground">{tx.description}</p>
        )}

        {tx.cancelReason && (
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {t("reason")}{" "}
            <span className="capitalize">{tx.cancelReason.replace(/_/g, " ")}</span>
            {tx.cancelNotes ? ` — ${tx.cancelNotes}` : ""}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-muted-foreground">
          <span>{formatDate(tx.timestamp)}</span>
          <StellarTxLink hash={tx.hash} chars={6} size="sm" />
          {tx.amount != null && (
            <span className="font-medium text-foreground">
              {formatCurrency(tx.amount, tx.currency ?? "USDC", true)}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <a
          href={safeStellarTxUrl(tx.hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("viewStellar")}
          title={t("viewStellar")}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <button
          type="button"
          onClick={() => onRemove(tx.hash)}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("remove")}
          title={t("remove")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionHistoryPage() {
  const { isConnected } = useWallet();
  const { setWalletModalOpen } = useUIStore();
  const { transactions, removeTransaction, clearHistory } = useTransactionStore();
  const { formatCurrency, formatNumber } = useFormatters();
  const t = useTranslations("transactions");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TxType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TxRecord["status"] | "all">("all");

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const confirmed = transactions.filter((t) => t.status === "confirmed");
    const totalVolume = confirmed
      .filter((t) => t.amount != null)
      .reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const byType = (type: TxType) => confirmed.filter((t) => t.type === type).length;

    return {
      total: transactions.length,
      confirmed: confirmed.length,
      failed: transactions.filter((t) => t.status === "failed").length,
      totalVolume,
      mints: byType("mint"),
      funds: byType("fund"),
    };
  }, [transactions]);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = transactions;

    if (typeFilter !== "all") {
      result = result.filter((t) => t.type === typeFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.hash.toLowerCase().includes(q) ||
          t.invoiceNumber?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [transactions, typeFilter, statusFilter, search]);

  // ── CSV export ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    exportCsv(
      filtered.map((t) => ({
        hash: t.hash,
        type: t.type,
        status: t.status,
        invoice: t.invoiceNumber ?? "",
        amount: t.amount ?? "",
        currency: t.currency ?? "USDC",
        description: t.description ?? "",
        timestamp: t.timestamp,
      })),
      "kora-transactions.csv"
    );
  };

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <History className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="text-xl font-semibold text-foreground">{t("connectTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("connectDesc")}
        </p>
        <Button onClick={() => setWalletModalOpen(true)}>{t("connectTitle")}</Button>
      </div>
    );
  }

  return (
    <Container className="py-10">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("exportCsv")}
          </Button>
          {transactions.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("clearAll")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      {transactions.length > 0 && (
        <ErrorBoundary compact>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: t("stats.total"),
                value: formatNumber(stats.total),
                valueRaw: stats.total,
                icon: <History className="h-4 w-4" />,
              },
              {
                label: t("stats.confirmed"),
                value: formatNumber(stats.confirmed),
                valueRaw: stats.confirmed,
                change: t("stats.failed", { count: stats.failed }),
                changePositive: stats.failed === 0,
                icon: <CheckCircle2 className="h-4 w-4" />,
              },
              {
                label: t("stats.totalVolume"),
                value: formatCurrency(stats.totalVolume, "USDC", true),
                valueRaw: stats.totalVolume,
                icon: <ArrowUpRight className="h-4 w-4" />,
              },
              {
                label: t("stats.invoicesFunded"),
                value: formatNumber(stats.funds),
                valueRaw: stats.funds,
                change: t("stats.minted", { count: stats.mints }),
                changePositive: true,
                icon: <Coins className="h-4 w-4" />,
              },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
              >
                <StatCard {...stat} />
              </motion.div>
            ))}
          </div>
        </ErrorBoundary>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <ErrorBoundary compact>
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label={t("searchAria")}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={t("clearSearch")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {/* Type filter */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("typeFilterAria")}>
              {TYPE_FILTER_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTypeFilter(value)}
                  aria-pressed={typeFilter === value}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    typeFilter === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  {t(`types.${value}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex gap-1.5" role="group" aria-label={t("statusFilterAria")}>
              {STATUS_FILTER_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    statusFilter === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  {t(`status.${value}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </ErrorBoundary>

      {/* ── Transaction List ─────────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">
              {filtered.length === 0
                ? t("listTitle")
                : filtered.length === 1
                  ? t("txCount", { count: filtered.length })
                  : t("txCountPlural", { count: filtered.length })}
            </CardTitle>
            {filtered.length !== transactions.length && (
              <span className="text-xs text-muted-foreground">
                {t("filteredFrom", { total: transactions.length })}
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {filtered.length === 0 ? (
              transactions.length === 0 ? (
                <EmptyState
                  title={t("empty.title")}
                  description={t("empty.description")}
                  variant="transactions"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <p className="mt-3 text-sm font-medium text-foreground">{t("noResults")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("noResultsDesc")}
                  </p>
                </div>
              )
            ) : (
              filtered.map((tx) => (
                <TxRow key={tx.hash} tx={tx} onRemove={removeTransaction} />
              ))
            )}
          </CardContent>
        </Card>
      </ErrorBoundary>
    </Container>
  );
}
