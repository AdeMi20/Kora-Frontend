"use client";

import { Suspense, useState, useMemo, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PlusCircle, TrendingUp, FileText, Clock, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Progress } from "@/components/ui/progress";
import { RepaymentDialog } from "@/components/invoice/RepaymentDialog";
import { DashboardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BatchResultSummary } from "@/components/dashboard/BatchActionToolbar";
import {
  prepareCancelInvoice,
  prepareRepayInvoice,
  submitAndConfirm,
  fetchInvoicesByOwner,
} from "@/services/invoiceService";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import type { DataTableProps } from "@/types/table";
import { isEnabled, useFeatureFlag } from "@/lib/featureFlags";
import {
  createBatchTxQueue,
  persistBatchQueue,
  clearPersistedBatchQueue,
  type BatchQueueItem,
  type BatchQueueSnapshot,
  type BatchActionType,
} from "@/lib/batch/txQueue";
import { isBatchCancelEligible, isBatchRepayEligible } from "@/lib/batch/eligibility";
import { sequenceManager } from "@/lib/stellar/client";

const BatchActionToolbar = dynamic(
  () => import("@/components/dashboard/BatchActionToolbar").then((m) => m.BatchActionToolbar),
  { ssr: false, loading: () => <div className="h-14 w-full animate-pulse rounded-xl bg-zinc-900/40 border border-zinc-800" /> }
);

const BatchTxQueuePanel = dynamic(
  () => import("@/components/dashboard/BatchTxQueuePanel").then((m) => m.BatchTxQueuePanel),
  { ssr: false }
);

const DataTable = dynamic<DataTableProps<Invoice>>(
  () => import("@/components/ui/data-table").then((m) => m.DataTable),
  { ssr: false, loading: () => <DashboardSkeleton statCount={4} tableRows={5} tableCols={8} /> }
);
import { useWallet } from "@/hooks/useWallet";
import { useVerifiedAction } from "@/hooks/useVerifiedAction";
import { useSMEInvoices } from "@/hooks/useInvoices";
import { useTransaction } from "@/hooks/useTransaction";
import { useTxSimulation } from "@/hooks/useTxSimulation";
import { TxSimulationPreview } from "@/components/invoice/TxSimulationPreview";
import { useTranslations } from "next-intl";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { shouldShowRepaymentDueBanner, useMaturityReminder } from "@/hooks/useMaturityReminder";
import { useUIStore, useInvoiceStore } from "@/store";
import { useSettingsStore } from "@/store/settingsStore";
import { MOCK_INVOICES } from "@/services/mockData";
import {
  formatCurrency,
  formatDate,
  formatApr,
  cn,
} from "@/lib/utils";
import { InvoiceStatusBadge } from "@/components/invoice/InvoiceStatusBadge";
import { DebtorDisplay } from "@/components/invoice/DebtorDisplay";
import type { Invoice } from "@/types";
import type { InvoiceStatus } from "@/types/invoice";
import type { ColumnDef } from "@/types/table";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import ShareInvoiceButton from "@/components/invoice/ShareInvoiceButton";

// Filter values in display order. Labels resolve from
// `smeDashboard.statusFilters.*` at render time so the dropdown follows the
// active locale instead of shipping English chrome to every reader.
const STATUS_FILTER_VALUES: Array<InvoiceStatus | "all"> = [
  "all",
  "draft",
  "pending_mint",
  "listed",
  "partially_funded",
  "fully_funded",
  "active",
  "repaid",
  "defaulted",
  "cancelled",
];

// ─── Skeleton for stats grid while data loads ─────────────────────────────────

function StatsGridSkeleton() {
  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

// ─── Stats grid — suspends until invoices are loaded ─────────────────────────

function SMEStatsGrid({ address }: { address: string }) {
  const { data: rawData } = useSuspenseQuery({
    queryKey: queryKeys.invoices.byOwner(address),
    queryFn: () => fetchInvoicesByOwner(address),
    staleTime: 30_000,
  });

  const myInvoices: Invoice[] = (rawData ?? []).filter(
    (inv: Invoice) => inv.ownerAddress === address
  );

  const fundedInvoices = myInvoices.filter((i) =>
    ["fully_funded", "active", "repaid", "defaulted"].includes(i.status)
  );
  const repaidInvoices = myInvoices.filter((i) => i.status === "repaid");
  const repaymentRate =
    fundedInvoices.length > 0
      ? Math.round((repaidInvoices.length / fundedInvoices.length) * 100)
      : 0;

  const stats = [
    {
      label: "Total Financed",
      value: formatCurrency(myInvoices.reduce((s, i) => s + i.funding.totalRaised, 0), "USDC", true),
      change: "12.4% this month",
      changePositive: true,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Active Invoices",
      value: myInvoices.filter((i) => ["listed", "partially_funded", "fully_funded"].includes(i.status)).length.toString(),
      icon: <FileText className="h-4 w-4" />,
    },
    {
      label: "Pending Repayment",
      value: formatCurrency(
        myInvoices.filter((i) => i.status === "fully_funded").reduce((s, i) => s + i.metadata.amount, 0),
        "USDC",
        true
      ),
      icon: <Clock className="h-4 w-4" />,
    },
    {
      label: "Repayment Rate",
      value: `${repaymentRate}%`,
      change: `${repaidInvoices.length}/${fundedInvoices.length} repaid`,
      changePositive: repaymentRate >= 80,
      icon: <CheckCircle2 className="h-4 w-4" />,
    },
  ];

  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => (
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
  );
}


import { useRouter } from "next/navigation";

export default function SMEDashboardPage() {
  const router = useRouter();
  const { isConnected, address, signTransaction } = useWallet();
  const { setWalletModalOpen } = useUIStore();
  const t = useTranslations("smeDashboard");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const invoicesQuery = useSMEInvoices(address ?? undefined);
  const { execute, status: txStatus } = useTransaction();
  const { simulationDialogProps, onSimulationPreview } = useTxSimulation();
  const { data: usdcBalance = 0 } = useUsdcBalance(address ?? undefined);
  const repaymentAlerts = useSettingsStore((state) => state.notifications.repaymentAlerts);

  const batchActionsEnabled = useFeatureFlag("batch-actions");
  const queueRef = useRef(createBatchTxQueue());

  const [repayTarget, setRepayTarget] = useState<Invoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([]);
  const [batchSnapshot, setBatchSnapshot] = useState<BatchQueueSnapshot | null>(null);
  const [batchAction, setBatchAction] = useState<BatchActionType>("cancel");
  const [batchResults, setBatchResults] = useState<{
    total: number;
    success: number;
    failed: number;
    errors: Array<{ id: string; error: string }>;
  } | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [repayConfirmOpen, setRepayConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");

  const allMyInvoices: Invoice[] = (invoicesQuery.data || MOCK_INVOICES).filter(
    (inv: Invoice) => inv.ownerAddress === address
  );

  useEffect(() => {
    const unsubscribe = queueRef.current.subscribe((snap) => {
      setBatchItems(snap.items);
      setBatchSnapshot(snap);
      setIsBatchProcessing(snap.isRunning);
      setBatchProgress(
        snap.items.length === 0 ? 0 : (snap.processed / snap.items.length) * 100
      );
      persistBatchQueue(snap.items);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const myInvoices: Invoice[] =
    statusFilter === "all"
      ? allMyInvoices
      : allMyInvoices.filter((inv) => inv.status === statusFilter);

  const selectedCancelEligible = useMemo(
    () => allMyInvoices.filter((inv) => selectedIds.includes(inv.id) && isBatchCancelEligible(inv)),
    [allMyInvoices, selectedIds]
  );
  const selectedRepayEligible = useMemo(
    () => allMyInvoices.filter((inv) => selectedIds.includes(inv.id) && isBatchRepayEligible(inv)),
    [allMyInvoices, selectedIds]
  );

  useMaturityReminder(
    allMyInvoices.filter((invoice) => ["listed", "partially_funded", "fully_funded"].includes(invoice.status))
  );

  // Must run before the early return below so hook order stays stable across renders.
  const { executeProtectedAction } = useVerifiedAction();

  const runBatchExecutor = useCallback(
    async (item: BatchQueueItem) => {
      if (!address) throw new Error("Wallet not connected");
      // Ensure SequenceManager stays in the batch path (builders/submit use it).
      void sequenceManager;

      const unsignedXdr =
        item.action === "cancel"
          ? await prepareCancelInvoice(item.tokenId, address)
          : await prepareRepayInvoice(item.tokenId, address, address);

      const signedXdr = await signTransaction(unsignedXdr);
      const txHash = await submitAndConfirm(signedXdr);
      return { txHash };
    },
    [address, signTransaction]
  );

  if (!isConnected) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <EmptyState
          variant="no-invoices"
          title={t("connectTitle")}
          description={t("connectDesc")}
          cta={{ label: tCommon("connectWallet"), onClick: () => setWalletModalOpen(true) }}
        />
      </div>
    );
  }

  const handleRepay = async (inv: Invoice) => {
    if (!address) return;

    await executeProtectedAction(
      async () => {
        const rollback = () => {
          useInvoiceStore.getState().rollbackInvoiceStatus(inv.id);
          queryClient.setQueryData(queryKeys.invoices.byOwner(address), (old: any) => {
            if (!old) return old;
            if (Array.isArray(old)) {
              return old.map((invoice: Invoice) =>
                invoice.id === inv.id ? { ...invoice, status: inv.status } : invoice
              );
            }
            if (old?.data) {
              return {
                ...old,
                data: old.data.map((invoice: Invoice) =>
                  invoice.id === inv.id ? { ...invoice, status: inv.status } : invoice
                ),
              };
            }
            return old;
          });
        };

        useInvoiceStore.getState().updateInvoiceStatus(inv.id, "repaid");
        queryClient.setQueryData(queryKeys.invoices.byOwner(address), (old: any) => {
          if (!old) return old;
          if (Array.isArray(old)) {
            return old.map((invoice: Invoice) =>
              invoice.id === inv.id ? { ...invoice, status: "repaid" } : invoice
            );
          }
          if (old?.data) {
            return {
              ...old,
              data: old.data.map((invoice: Invoice) =>
                invoice.id === inv.id ? { ...invoice, status: "repaid" } : invoice
              ),
            };
          }
          return old;
        });

        const txHash = await execute(
          () => prepareRepayInvoice(inv.tokenId, address, inv.ownerAddress),
          {
            successMessage: "Yield distributed to investors",
            successNotificationType: "yieldAvailable",
            onSimulationPreview,
            onError: rollback,
            onSuccess: () => {
              invoicesQuery.refetch();
              setRepayTarget(null);
            },
          }
        );

        if (!txHash) {
          rollback();
        }
      },
      "repayment"
    );
  };

  const handleCancel = async (inv: Invoice) => {
    if (!address) return;
    await execute(
      async () => {
        const unsignedXdr = await prepareCancelInvoice(inv.tokenId, address);
        return unsignedXdr;
      },
      {
        successMessage: "Invoice cancellation submitted",
        onSimulationPreview,
        onSuccess: () => {
          invoicesQuery.refetch();
        },
      }
    );
  };

  const handleBatchCancel = async () => {
    if (!address || !batchActionsEnabled || selectedIds.length === 0) return;

    if (selectedCancelEligible.length === 0) {
      toast.error(
        "No eligible invoices selected. Only unfunded listed/pending invoices can be batch-cancelled."
      );
      return;
    }

    setBatchAction("cancel");
    setCancelConfirmOpen(true);
  };

  const handleBatchRepay = async () => {
    if (!address || !batchActionsEnabled || selectedIds.length === 0) return;

    if (selectedRepayEligible.length === 0) {
      toast.error(
        "No eligible invoices selected. Only fully funded invoices past their due date can be batch-repaid."
      );
      return;
    }

    setBatchAction("repay");
    setRepayConfirmOpen(true);
  };


  const finishBatch = (action: BatchActionType) => {
    const snap = queueRef.current.getSnapshot();
    setBatchResults({
      total: snap.items.length,
      success: snap.successCount,
      failed: snap.failedCount,
      errors: snap.items
        .filter((i) => i.status === "failed")
        .map((i) => ({ id: i.label, error: i.error ?? "Unknown error" })),
    });
    if (snap.failedCount === 0) {
      clearPersistedBatchQueue();
      setSelectedIds([]);
    }
    invoicesQuery.refetch();
    toast.message(
      `Batch ${action} finished: ${snap.successCount} succeeded, ${snap.failedCount} failed`
    );
  };

  /** Called after the user clicks "Confirm" in the cancel confirmation dialog */
  const executeBatchCancel = async () => {
    if (!address || selectedCancelEligible.length === 0) return;
    setCancelConfirmOpen(false);

    queueRef.current.load(
      selectedCancelEligible.map((inv) => ({
        id: inv.id,
        tokenId: inv.tokenId,
        label: inv.metadata.invoiceNumber,
        action: "cancel" as const,
      }))
    );

    await queueRef.current.start(runBatchExecutor);
    finishBatch("cancel");
  };

  const executeBatchRepay = async () => {
    if (!address || selectedRepayEligible.length === 0) return;
    setRepayConfirmOpen(false);

    queueRef.current.load(
      selectedRepayEligible.map((inv) => ({
        id: inv.id,
        tokenId: inv.tokenId,
        label: inv.metadata.invoiceNumber,
        action: "repay" as const,
      }))
    );

    await queueRef.current.start(runBatchExecutor);
    finishBatch("repay");
  };

  const handleResumeFailed = async () => {
    setBatchResults(null);
    await queueRef.current.resumeFailed(runBatchExecutor);
    finishBatch(batchAction);
  };

  const handleBatchExport = () => {
    const selectedInvoices = allMyInvoices.filter((inv) => selectedIds.includes(inv.id));
    if (selectedInvoices.length === 0) return;

    const headers = [
      "Invoice Number", "Debtor", "Amount", "Currency", 
      "APR", "Status", "Due Date", "Created At"
    ];

    const rows = selectedInvoices.map(inv => [
      inv.metadata.invoiceNumber,
      inv.metadata.debtorName,
      inv.metadata.amount,
      inv.metadata.currency,
      inv.terms.apr,
      inv.status,
      inv.metadata.dueDate,
      inv.createdAt
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `invoices_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${selectedInvoices.length} invoices to CSV`);
  };

  return (
    <ErrorBoundary>
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/invoice/create">
          <Button>
            <PlusCircle className="h-4 w-4" /> {t("newInvoice")}
          </Button>
        </Link>
      </div>

      {!batchActionsEnabled && (
        <div
          role="note"
          className="mb-6 flex gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">{t("batch.disabledTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("batch.disabledDesc", { envVar: "NEXT_PUBLIC_ENABLE_BATCH_ACTIONS" })}{" "}
              <a
                href="https://github.com/OpenLedger-Foundation/Kora-Frontend/blob/main/docs/feature-flags.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {t("batch.disabledDocs")}
              </a>
            </p>
          </div>
        </div>
      )}

      {address && (
        <Suspense fallback={<StatsGridSkeleton />}>
          <SMEStatsGrid address={address} />
        </Suspense>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t("myInvoices")}</CardTitle>
              <div className="flex items-center gap-2">
                <label htmlFor="sme-status-filter" className="text-xs text-muted-foreground">
                  {t("filters.statusLabel")}
                </label>
                <select
                  id="sme-status-filter"
                  aria-label={t("filters.statusAria")}
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as InvoiceStatus | "all");
                    // Drop selections that the new filter may hide.
                    setSelectedIds([]);
                    if (typeof window !== "undefined") {
                      const params = new URLSearchParams(window.location.search);
                      params.set("sme_page", "1");
                      router.push(`${window.location.pathname}?${params.toString()}`);
                    }
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {STATUS_FILTER_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {t(`statusFilters.${value}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
          <DataTable
            data={myInvoices}
            enableSelection={batchActionsEnabled}
            onSelectionChange={setSelectedIds}
            syncToUrl={true}
            pageParamName="sme_page"
            sortParamName="sme_sort"
            pageSizeParamName="sme_pageSize"
            columns={(() => {
              const cols: ColumnDef<Invoice>[] = [
                {
                  id: "invoice",
                  header: t("table.invoice"),
                  accessor: (row) => row.metadata.invoiceNumber,
                  cell: (row) => (
                    <div>
                      <p className="font-medium text-foreground">{row.metadata.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{row.metadata.category}</p>
                    </div>
                  ),
                },
                {
                  id: "debtor",
                  header: t("table.debtor"),
                  accessor: (row) => row.metadata.debtorName,
                  cell: (row) => <DebtorDisplay invoice={row} isFunded={true} />,
                },
                {
                  id: "amount",
                  header: t("table.amount"),
                  accessor: (row) => row.metadata.amount,
                  cell: (row) => (
                    <span className="font-medium text-foreground">
                      {formatCurrency(row.metadata.amount, row.metadata.currency, true)}
                    </span>
                  ),
                },
                {
                  id: "apr",
                  header: t("table.apr"),
                  accessor: (row) => row.terms.apr,
                  cell: (row) => <span className="font-medium text-primary">{formatApr(row.terms.apr)}</span>,
                },
                {
                  id: "progress",
                  header: t("table.progress"),
                  accessor: (row) => row.funding.fundingProgress,
                  cell: (row) => (
                    <div className="w-32 space-y-1">
                      <Progress value={row.funding.fundingProgress * 100} className="h-1.5" />
                      <p className="text-xs text-muted-foreground">{Math.round(row.funding.fundingProgress * 100)}%</p>
                    </div>
                  ),
                },
                {
                  id: "status",
                  header: t("table.status"),
                  accessor: (row) => row.status,
                  cell: (row) => (
                    <InvoiceStatusBadge status={row.status} />
                  ),
                },
                {
                  id: "due",
                  header: t("table.dueDate"),
                  accessor: (row) => row.terms.repaymentDate,
                  cell: (row) => (
                    <span className="text-xs text-muted-foreground">{formatDate(row.terms.repaymentDate)}</span>
                  ),
                },
                {
                  id: "actions",
                  header: "",
                  sortable: false,
                  cell: (row) => {
                    const isDue = new Date(row.terms.repaymentDate) <= new Date();
                    const canRepay = row.status === "fully_funded" && isDue;
                    const canCancel = (row.status === "listed" || row.status === "pending_mint") && row.funding.totalRaised === 0;

                    return (
                      <div className="flex items-center gap-2">
                        {canRepay && (
                          <Button size="sm" onClick={() => setRepayTarget(row)}>
                            {t("table.repay")}
                          </Button>
                        )}
                        {canCancel && (
                          <Button size="sm" variant="ghost" onClick={() => handleCancel(row)}>
                            {t("table.cancel")}
                          </Button>
                        )}
                        <div className="flex items-center gap-2">
                          <ShareInvoiceButton id={row.id} tokenId={row.tokenId} invoiceTitle={row.metadata.invoiceNumber} summary={row.metadata.description} />
                          <Link href={`/marketplace/${row.id}`} className="text-xs text-primary hover:opacity-80">
                            View →
                          </Link>
                        </div>
                      </div>
                    );
                  },
                },
              ];
              return cols;
            })()}
            pageSize={5}
            bulkActions={
              <Button type="button" variant="outline" size="sm">
                Export selected
              </Button>
            }
            isLoading={invoicesQuery.isLoading}
            emptyState={
              statusFilter === "all"
                ? {
                    title: t("empty.title"),
                    message: t("empty.message"),
                    illustration: <FileText className="h-10 w-10 text-muted-foreground" />,
                  }
                : {
                    title: "No matching invoices",
                    message: "No invoices have this status. Choose “All statuses” to see everything.",
                    illustration: <FileText className="h-10 w-10 text-muted-foreground" />,
                  }
            }
          />
        </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {shouldShowRepaymentDueBanner(allMyInvoices, repaymentAlerts) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-start gap-3 rounded-xl border border-warning/20 bg-warning/5 p-4"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-warning">Repayment Due Soon</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You have invoices approaching their repayment date. Ensure sufficient USDC balance.
            </p>
          </div>
        </motion.div>
          )}
        </div>
      </div>

      <RepaymentDialog
        invoice={repayTarget}
        open={!!repayTarget}
        onOpenChange={(open) => { if (!open) setRepayTarget(null); }}
        onConfirm={handleRepay}
        isLoading={txStatus !== "idle" && txStatus !== "confirmed" && txStatus !== "failed"}
        insufficientBalance={
          !!repayTarget &&
          usdcBalance <
            repayTarget.funding.totalRaised * (1 + repayTarget.terms.discountRate)
        }
      />

      {batchActionsEnabled && (
        <>
          {batchSnapshot && batchSnapshot.items.length > 0 && (
            <BatchTxQueuePanel
              snapshot={batchSnapshot}
              onResumeFailed={handleResumeFailed}
              onDismiss={() => setBatchSnapshot(null)}
              className="mb-4"
            />
          )}
          <BatchActionToolbar
            selectedCount={selectedIds.length}
            onCancel={handleBatchCancel}
            onRepay={handleBatchRepay}
            onExport={handleBatchExport}
            isProcessing={isBatchProcessing}
            progress={batchProgress}
            processingLabel={
              batchAction === "repay"
                ? `Repaying ${batchItems.length || selectedIds.length} invoices...`
                : `Cancelling ${batchItems.length || selectedIds.length} invoices...`
            }
            items={batchItems}
            onResumeFailed={handleResumeFailed}
            canCancel={selectedCancelEligible.length > 0}
            canRepay={selectedRepayEligible.length > 0}
          />
        </>
      )}

      <Dialog open={!!batchResults} onOpenChange={(open) => !open && setBatchResults(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batch Operation Summary</DialogTitle>
          </DialogHeader>
          {batchResults && (
            <BatchResultSummary
              total={batchResults.total}
              successCount={batchResults.success}
              failedCount={batchResults.failed}
              errors={batchResults.errors}
              onClose={() => setBatchResults(null)}
              onResumeFailed={handleResumeFailed}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("batchCancel.title", { count: selectedCancelEligible.length })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.rich("batchCancel.body", {
                count: selectedCancelEligible.length,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelConfirmOpen(false)}
                data-testid="cancel-confirm-dismiss"
              >
                {t("goBack")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={executeBatchCancel}
                data-testid="cancel-confirm-proceed"
              >
                {t("batchCancel.confirm", { count: selectedCancelEligible.length })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Repay confirmation dialog */}
      <Dialog open={repayConfirmOpen} onOpenChange={setRepayConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("batchRepay.title", { count: selectedRepayEligible.length })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.rich("batchRepay.body", {
                count: selectedRepayEligible.length,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRepayConfirmOpen(false)}
                data-testid="repay-confirm-dismiss"
              >
                {t("goBack")}
              </Button>
              <Button
                size="sm"
                onClick={executeBatchRepay}
                data-testid="repay-confirm-proceed"
              >
                {t("batchRepay.confirm", { count: selectedRepayEligible.length })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transaction simulation preview dialog */}
      <TxSimulationPreview {...simulationDialogProps} />
    </div>
    </ErrorBoundary>
  );
}
