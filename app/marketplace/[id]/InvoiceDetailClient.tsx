"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  FileText,
  Users,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Shield,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  GlassCard,
} from "@/components/ui/card";
import { InvoiceFundingProgress } from "@/components/ui/progress";
import { InvoiceDetailSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useInvoice } from "@/hooks/useInvoices";
import { useWallet } from "@/hooks/useWallet";
import { useVerifiedAction } from "@/hooks/useVerifiedAction";
import { useToast } from "@/hooks/useToast";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { env } from "@/lib/env";
import { usePositions } from "@/hooks/usePositions";
import { useTransaction } from "@/hooks/useTransaction";
import { useTxSimulation } from "@/hooks/useTxSimulation";
import { TxSimulationPreview } from "@/components/invoice/TxSimulationPreview";
import { useUIStore, useInvoiceStore, useWalletKycStatus } from "@/store";
import { prepareFundInvoice } from "@/services/invoiceService";
import { RiskBadge } from "@/components/ui/badge";
import ShareInvoiceButton from "@/components/invoice/ShareInvoiceButton";
import { MOCK_INVOICES } from "@/services/mockData";
import {
  daysUntil,
  cn,
} from "@/lib/utils";
import { useFormatters } from "@/hooks/useFormatters";
import type { Invoice } from "@/types";
import CountdownTimer from "@/components/ui/CountdownTimer";
import { InvoiceStatusBadge } from "@/components/invoice/InvoiceStatusBadge";
import { RiskScoreGauge } from "@/components/invoice/RiskScoreGauge";
import { DebtorDisplay } from "@/components/invoice/DebtorDisplay";
import { InvoiceMetadataViewer } from "@/components/invoice/InvoiceMetadataViewer";
import {
  validateRouteId,
  safeIpfsUrl,
  safeExternalUrl,
  safeStellarTxUrl,
} from "@/lib/security";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { FundingYieldCalculator } from "@/components/invoice/FundingYieldCalculator";
import { TestnetUsdcFaucet } from "@/components/wallet/TestnetUsdcFaucet";
import {
  isTestnetUsdcFaucetEnabled,
  useUsdcBalance,
} from "@/hooks/useUsdcBalance";
import { PrintLayout, PrintButton } from "@/components/ui/print-layout";
import { exportInvoiceCalendarIcs } from "@/lib/export";
import { InvoiceOrderBookDepth } from "@/components/invoice/InvoiceOrderBookDepth";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function InvoiceDetailClient({ id }: { id: string }) {
  const t = useTranslations("invoiceDetail");
  const { data: invoice, isLoading, error, dataUpdatedAt } = useInvoice(id);
  const { isConnected, address, balance } = useWallet();
  const kycStatus = useWalletKycStatus();
  const { isOnline } = useNetworkStatus();
  const { data: queriedUsdcBalance, refetch: refetchUsdcBalance } =
    useUsdcBalance(address ?? undefined);
  const toast = useToast();
  const { data: positions } = usePositions(address ?? undefined);
  const { setWalletModalOpen } = useUIStore();
  const { execute } = useTransaction();
  const { simulationDialogProps, onSimulationPreview } = useTxSimulation();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [funding, setFunding] = useState(false);
  const [fundTxHash, setFundTxHash] = useState<string | null>(null);
  type IframeState = "loading" | "loaded" | "error" | "offline";
  const [iframeState, setIframeState] = useState<IframeState>("loading");
  // Cache-buster incremented on each retry; appended to the gateway URL so the
  // browser bypasses cached 4xx/5xx responses.
  const [iframeRetryKey, setIframeRetryKey] = useState(0);
  const iframeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Backwards-compat shims used in JSX that referenced the old booleans.
  const iframeLoaded = iframeState === "loaded";
  const iframeError = iframeState === "error" || iframeState === "offline";

  /** 15 s gateway timeout — starts when the iframe URL changes (retry or first load). */
  const startIframeTimeout = useCallback(() => {
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      setIframeState((prev) => {
        if (prev === "loaded") return prev; // already succeeded
        // Log without PII — only an anonymised prefix of the invoice id is emitted.
        const idHint = id.slice(0, 8).replace(/./g, (c, i) => (i > 3 ? "*" : c));
        console.warn(`[ipfs-preview] Gateway timeout for invoice ${idHint}`);
        return "error";
      });
    }, 15_000);
  }, [id]);

  /** Clean up the timeout when the component unmounts. */
  useEffect(() => {
    return () => {
      if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    };
  }, []);

  /**
   * If the user is offline when this component mounts (or goes offline while
   * the iframe is still loading), immediately show the offline fallback instead
   * of waiting for the 15 s timeout to fire.
   */
  useEffect(() => {
    if (!isOnline) {
      setIframeState((prev) => (prev === "loaded" ? prev : "offline"));
      if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    }
  }, [isOnline]);

  /** Increment the retry key to trigger a new iframe src with a cache-buster. */
  const handleIframeRetry = useCallback(() => {
    if (!isOnline) {
      setIframeState("offline");
      return;
    }
    setIframeState("loading");
    setIframeRetryKey((k) => k + 1);
  }, [isOnline]);

  /**
   * Build the iframe src for the current retry attempt.
   * A `_cb` query param is appended on retries so the browser fetches a fresh
   * copy; the `#toolbar=0` fragment keeps PDF chrome hidden.
   */
  const buildIframeSrc = useCallback(
    (baseUrl: string, retryKey: number) => {
      const cacheBuster = retryKey > 0 ? `?_cb=${retryKey}` : "";
      return `${baseUrl}${cacheBuster}#toolbar=0&navpanes=0&scrollbar=0`;
    },
    [],
  );
  const { formatCurrency, formatApr, formatDate, formatPercentage } = useFormatters();
  const { executeProtectedAction } = useVerifiedAction();

  if (!id || isLoading) return <InvoiceDetailSkeleton />;
  if (!invoice) return notFound();

  // Post-fund reveal check
  const isFunded = positions?.some((p) => p.invoiceId === id) || !!fundTxHash;

  const { metadata, terms, funding: fundingState, riskTier, status } = invoice;
  const days = daysUntil(terms.repaymentDate);
  const daysToMaturity = Math.max(0, days);

  // SME Owner Gating Check
  const isSmeOwner =
    isConnected &&
    address &&
    invoice.ownerAddress &&
    address.toLowerCase() === invoice.ownerAddress.toLowerCase();

  // Already Fully Funded Check
  const isFullyFunded =
    fundingState.fundingProgress >= 1.0 || status === "fully_funded";

  // Stateful Gating Eligibility
  const canFund =
    (status === "listed" || status === "partially_funded") &&
    !isFullyFunded &&
    !isSmeOwner;

  const amountNum = parseFloat(amount) || 0;
  // Prefer live USDC query; fall back to wallet store balance.
  const usdcBalance =
    typeof queriedUsdcBalance === "number"
      ? queriedUsdcBalance
      : balance?.usdc
        ? Number(balance.usdc)
        : null;
  const showTestnetFaucet =
    isTestnetUsdcFaucetEnabled() &&
    isConnected &&
    usdcBalance !== null &&
    (usdcBalance <= 0 || (amountNum > 0 && amountNum > usdcBalance));

  // Precise holding period Expected Return Calculator
  const expectedReturn =
    amountNum * (1 + (terms.apr / 100) * (daysToMaturity / 365));

  const documentPreviewUrl =
    metadata.documentUrl && safeExternalUrl(metadata.documentUrl) !== "#"
      ? safeExternalUrl(metadata.documentUrl)
      : safeIpfsUrl(metadata.documentHash, env.NEXT_PUBLIC_IPFS_GATEWAY);
  const hasDocument = Boolean(documentPreviewUrl && documentPreviewUrl !== "#");

  const riskFactors = [
    {
      key: "payment_history",
      label: "Payment History",
      score: Math.max(20, Math.min(98, invoice.riskScore + 8)),
    },
    {
      key: "debtor_size",
      label: "Debtor Size",
      score: Math.max(15, Math.min(95, invoice.riskScore - 6)),
    },
    {
      key: "jurisdiction",
      label: "Jurisdiction",
      score: Math.max(
        10,
        Math.min(
          92,
          invoice.riskScore +
            (invoice.metadata.jurisdiction === "US" ||
            invoice.metadata.jurisdiction === "EU"
              ? 4
              : -8),
        ),
      ),
    },
    {
      key: "invoice_age",
      label: "Invoice Age",
      score: Math.max(
        12,
        Math.min(
          96,
          invoice.riskScore - Math.min(18, Math.floor(daysToMaturity / 4)),
        ),
      ),
    },
  ];

  const riskTrend = (() => {
    const sameDebtor = MOCK_INVOICES.filter(
      (inv) =>
        inv.metadata.debtorName === invoice.metadata.debtorName &&
        inv.id !== invoice.id,
    )
      .slice(0, 4)
      .map((inv) => inv.riskScore);

    const combined = [...sameDebtor, invoice.riskScore];
    while (combined.length < 5) {
      const seed = combined[0] ?? invoice.riskScore;
      combined.unshift(
        Math.max(0, Math.min(100, seed + (combined.length % 2 === 0 ? -4 : 3))),
      );
    }
    return combined.slice(-5);
  })();

  // Input validations for min-investment and remaining capacities
  const kycThreshold = env.NEXT_PUBLIC_KYC_FUND_THRESHOLD;
  let inputError = "";
  if (amountNum > 0) {
    if (amountNum < terms.minInvestment) {
      inputError = `Minimum investment is ${formatCurrency(terms.minInvestment, metadata.currency)}`;
    } else if (amountNum > fundingState.remainingCapacity) {
      inputError = `Amount exceeds remaining capacity of ${formatCurrency(fundingState.remainingCapacity, metadata.currency)}`;
    } else if (amountNum > kycThreshold && kycStatus !== "verified") {
      inputError = `Investments above ${formatCurrency(kycThreshold, "USDC")} require KYC identity verification.`;
    }
  }
  const insufficientBalanceMessage =
    isConnected && usdcBalance !== null && amountNum > usdcBalance
      ? t("errors.insufficientBalance", {
          amount: formatCurrency(usdcBalance, "USDC"),
        })
      : "";


  const handleFund = async () => {
    if (!isOnline) {
      toast.error(
        "You're offline",
        "Reconnect to the internet to fund this invoice."
      );
      return;
    }
    if (!isConnected) {
      setWalletModalOpen(true);
      return;
    }
    if (
      !amountNum ||
      amountNum < terms.minInvestment ||
      amountNum > fundingState.remainingCapacity
    )
      return;
    const kycThreshold = env.NEXT_PUBLIC_KYC_FUND_THRESHOLD;
    if (amountNum > kycThreshold && kycStatus !== "verified") {
      toast.error(
        "KYC Verification Required",
        `Under regulatory compliance rules, investments exceeding ${formatCurrency(kycThreshold, "USDC")} require full identity verification. Please verify your KYC in settings to proceed.`
      );
      return;
    }

    if (usdcBalance !== null && amountNum > usdcBalance) {
      toast.error(
        "Insufficient balance",
        `You have ${formatCurrency(usdcBalance, "USDC")} available, but tried to invest ${formatCurrency(amountNum, "USDC")}.`,
      );
      return;
    }

    await executeProtectedAction(
      async () => {
        setFunding(true);

        // Optimistic update: immediately reflect new totals in UI
        const newTotalRaised = fundingState.totalRaised + amountNum;
        const optimisticInvoice: Invoice = {
          ...invoice,
          status:
            newTotalRaised >= terms.financingAmount
              ? "fully_funded"
              : "partially_funded",
          funding: {
            ...fundingState,
            totalRaised: newTotalRaised,
            investorCount: fundingState.investorCount + 1,
            remainingCapacity: Math.max(0, terms.financingAmount - newTotalRaised),
            fundingProgress: Math.min(1, newTotalRaised / terms.financingAmount),
          },
        };
        useInvoiceStore.getState().updateInvoiceFunding(id, newTotalRaised);
        queryClient.setQueryData(["invoice", id], optimisticInvoice);

        await execute(
          () => prepareFundInvoice(invoice.tokenId, amountNum, address!),
          {
            successMessage: "Invoice funded successfully!",
            successNotificationType: "invoiceFunded",
            onSimulationPreview,
            onSuccess: (txHash) => {
              setFundTxHash(txHash);

              // Calculate optimistic state changes
              const newTotalRaised = fundingState.totalRaised + amountNum;
              const isFull = newTotalRaised >= terms.financingAmount;
              const newInvestorCount = fundingState.investorCount + 1;
              const newRemaining = Math.max(
                0,
                terms.financingAmount - newTotalRaised,
              );
              const newProgress = Math.min(
                1,
                newTotalRaised / terms.financingAmount,
              );
              const newStatus = isFull ? "fully_funded" : "partially_funded";

              const updatedInvoice: Invoice = {
                ...invoice,
                status: newStatus,
                funding: {
                  ...fundingState,
                  totalRaised: newTotalRaised,
                  investorCount: newInvestorCount,
                  remainingCapacity: newRemaining,
                  fundingProgress: newProgress,
                },
              };

              // 1. Update Memory array directly so the list pages show dynamic updates
              if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
                const mockIdx = MOCK_INVOICES.findIndex((i) => i.id === id);
                if (mockIdx !== -1) {
                  MOCK_INVOICES[mockIdx] = updatedInvoice;
                }
              }

              // 2. Update Zustand store invoices list
              const { invoices, setInvoices } = useInvoiceStore.getState();
              if (invoices && invoices.length > 0) {
                const updatedInvoices = invoices.map((inv) =>
                  inv.id === id ? updatedInvoice : inv,
                );
                setInvoices(updatedInvoices);
              }

              // 3. Update TanStack Server cache
              queryClient.setQueryData(["invoice", id], updatedInvoice);
              queryClient.invalidateQueries({ queryKey: ["invoices"] });

              // Clear form input amount
              setAmount("");
            },
            onError: (err) => {
              // Rollback optimistic change
              useInvoiceStore.getState().rollbackInvoiceFunding(id);
              queryClient.setQueryData(["invoice", id], invoice);
              console.error("Fund transaction failed", err);
            },
          },
        );
        setFunding(false);
      },
      "funding"
    );
  };

  return (
    <ErrorBoundary>
      {/* JSON-LD is rendered server-side in page.tsx for crawler-friendly SEO */}
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <Breadcrumb
            items={[
              { label: "Home", href: "/" },
              { label: "Marketplace", href: "/marketplace" },
              { label: metadata.invoiceNumber },
            ]}
          />
          <PrintButton label="Print / Save PDF" />{" "}
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* ── Left: Invoice Details ─────────────────────────────────────── */}
          <PrintLayout
            title={metadata.invoiceNumber}
            subtitle={`${metadata.debtorName} · ${metadata.issuerName}`}
            className="space-y-6 lg:col-span-2"
          >
            {/* Header card */}
            <motion.div
              layoutId={`invoice-card-${id}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        {metadata.invoiceNumber}
                      </p>
                      <DebtorDisplay
                        invoice={invoice}
                        isFunded={isFunded}
                        className="mt-1"
                      />
                      <p className="mt-1.5 text-sm font-medium text-zinc-500">
                        {metadata.issuerName}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <RiskBadge tier={riskTier} />
                      <div className="flex items-center gap-2">
                        <InvoiceStatusBadge status={status} />
                        <button
                          type="button"
                          onClick={() => exportInvoiceCalendarIcs(invoice)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white transition-colors"
                          title="Add maturity date to calendar (.ics)"
                          aria-label="Add maturity date to calendar"
                        >
                          <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Add to Calendar</span>
                        </button>
                        <ShareInvoiceButton
                          id={invoice.tokenId || id}
                          tokenId={invoice.tokenId}
                          invoiceTitle={metadata.invoiceNumber}
                          summary={metadata.description}
                        />
                        {funding && (
                          <span className="rounded-md bg-yellow-600/20 px-2 py-0.5 text-[11px] text-yellow-300">
                            Pending confirmation
                          </span>
                        )}
                      </div>

                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Calendar className="h-4 w-4 text-zinc-600" />
                      <span>Issued {formatDate(metadata.issueDate)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Calendar className="h-4 w-4 text-zinc-600" />
                      <span>Due {formatDate(metadata.dueDate)}</span>
                    </div>
                  </div>
                  {metadata.description && (
                    <p className="mt-4 text-sm text-zinc-500 leading-relaxed">
                      {metadata.description}
                    </p>
                  )}
                  {metadata.documentUrl && (
                    <a
                      href={safeExternalUrl(metadata.documentUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm text-kora-400 hover:text-kora-300"
                    >
                      <FileText className="h-4 w-4" /> View Invoice Document
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Financing terms */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Financing Terms</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      {
                        label: "Invoice Amount",
                        value: formatCurrency(
                          metadata.amount,
                          metadata.currency,
                          true,
                        ),
                      },
                      {
                        label: "Financing Amount",
                        value: formatCurrency(
                          terms.financingAmount,
                          metadata.currency,
                          true,
                        ),
                      },
                      {
                        label: "Discount Rate",
                        value: formatPercentage(terms.discountRate * 100, 1),
                      },
                      {
                        label: "APR",
                        value: formatApr(terms.apr),
                        highlight: true,
                      },
                      { label: "Tenor", value: `${terms.tenor} days` },
                      {
                        label: "Repayment Date",
                        value: formatDate(terms.repaymentDate),
                      },
                      {
                        label: "Min Investment",
                        value: formatCurrency(
                          terms.minInvestment,
                          metadata.currency,
                          true,
                        ),
                      },
                      {
                        label: "Max Investment",
                        value: formatCurrency(
                          terms.maxInvestment,
                          metadata.currency,
                          true,
                        ),
                      },
                      {
                        label: "Days Remaining",
                        value: (
                          <CountdownTimer
                            targetDate={terms.repaymentDate}
                            compact={false}
                          />
                        ),
                      },
                    ].map(({ label, value, highlight }) => (
                      <div
                        key={label}
                        className="rounded-lg bg-zinc-800/50 p-3"
                      >
                        <p className="text-xs text-zinc-500">{label}</p>
                        <p
                          className={cn(
                            "mt-1 text-sm font-semibold",
                            highlight ? "text-kora-400" : "text-zinc-200",
                          )}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Funding progress */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-zinc-500" /> Funding Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">
                      {formatCurrency(
                        fundingState.totalRaised,
                        metadata.currency,
                        true,
                      )}{" "}
                      raised
                    </span>
                    <span className="font-semibold text-zinc-200">
                      {formatPercentage(fundingState.fundingProgress * 100, 0)} of{" "}
                      {formatCurrency(
                        terms.financingAmount,
                        metadata.currency,
                        true,
                      )}
                    </span>
                  </div>
                  <InvoiceFundingProgress
                    funded={fundingState.totalRaised}
                    target={fundingState.targetAmount}
                    currency={metadata.currency}
                    updatedAt={dataUpdatedAt}
                  />
                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div>
                      <p className="text-xs text-zinc-500">Investors</p>
                      <p className="mt-0.5 text-lg font-semibold text-zinc-200">
                        {fundingState.investorCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Remaining</p>
                      <p className="mt-0.5 text-lg font-semibold text-zinc-200">
                        {formatCurrency(
                          fundingState.remainingCapacity,
                          metadata.currency,
                          true,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Closes</p>
                      <p className="mt-0.5 text-sm font-medium text-zinc-400">
                        {formatDate(terms.repaymentDate, "relative")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Repayment Timeline — shown when invoice is fully funded */}
            {isFullyFunded && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.17 }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-zinc-500" /> Repayment
                      Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RepaymentTimeline
                      fundedAt={invoice.createdAt}
                      maturityDate={terms.repaymentDate}
                      isRepaid={status === "repaid"}
                      repaidAt={status === "repaid" ? invoice.updatedAt : undefined}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* IPFS PDF Document Preview */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" /> IPFS Document
                    Preview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {hasDocument ? (
                    <div className="relative">
                      {/* ── Desktop: inline iframe preview ─────────────────── */}
                      <div className="hidden sm:block">
                        <div className="overflow-hidden rounded-lg bg-zinc-900 border border-zinc-800">
                          {/* Iframe — only mounted when not in error/offline state */}
                          {(iframeState === "loading" || iframeState === "loaded") && (
                            <iframe
                              key={iframeRetryKey}
                              src={buildIframeSrc(documentPreviewUrl!, iframeRetryKey)}
                              className={cn(
                                "w-full h-[450px] rounded",
                                iframeState === "loading" && "opacity-0 absolute",
                              )}
                              title={t("ipfsPreview")}
                              aria-label={t("ipfsPreview")}
                              referrerPolicy="no-referrer"
                              sandbox="allow-scripts allow-same-origin allow-popups"
                              onLoad={() => {
                                if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
                                setIframeState("loaded");
                              }}
                              onError={() => {
                                if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
                                const idHint = id.slice(0, 8).replace(/./g, (c, i) => (i > 3 ? "*" : c));
                                console.warn(`[ipfs-preview] Load error for invoice ${idHint}`);
                                setIframeState("error");
                              }}
                              ref={(el) => {
                                // Start the 15 s timeout the moment the iframe is mounted.
                                if (el) startIframeTimeout();
                              }}
                            />
                          )}

                          {/* Loading skeleton */}
                          {iframeState === "loading" && (
                            <div
                              className="flex items-center justify-center h-[450px]"
                              role="status"
                              aria-live="polite"
                            >
                              <div className="flex flex-col items-center gap-3 text-zinc-500">
                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
                                <span className="text-xs">{t("ipfsLoadingPreview")}</span>
                              </div>
                            </div>
                          )}

                          {/* Error / timeout fallback */}
                          {iframeState === "error" && (
                            <div
                              className="flex flex-col items-center justify-center h-[450px] p-6 text-center"
                              role="alert"
                              aria-live="assertive"
                            >
                              <AlertTriangle className="h-8 w-8 text-zinc-400 mb-4" />
                              <p className="text-sm font-medium text-zinc-300 mb-1">
                                {t("ipfsErrorTitle")}
                              </p>
                              <p className="text-xs text-zinc-500 mb-5 max-w-xs">
                                {t("ipfsErrorDesc")}
                              </p>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={handleIframeRetry}
                                  className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  {t("ipfsRetry")}
                                </button>
                                <a
                                  href={documentPreviewUrl!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-300 border border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
                                >
                                  {t("ipfsOpenInNewTab")}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          )}

                          {/* Offline fallback */}
                          {iframeState === "offline" && (
                            <div
                              className="flex flex-col items-center justify-center h-[450px] p-6 text-center"
                              role="alert"
                              aria-live="assertive"
                            >
                              <WifiOff className="h-8 w-8 text-amber-400 mb-4" />
                              <p className="text-sm font-medium text-amber-300 mb-1">
                                {t("ipfsOfflineTitle")}
                              </p>
                              <p className="text-xs text-zinc-500 mb-5 max-w-xs">
                                {t("ipfsOfflineDesc")}
                              </p>
                              <button
                                type="button"
                                onClick={handleIframeRetry}
                                className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                {t("ipfsRetry")}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Mobile: download link only ──────────────────────── */}
                      <div className="block sm:hidden bg-zinc-900 rounded-lg border border-zinc-800 p-6 text-center">
                        {iframeState === "error" ? (
                          <div className="flex flex-col items-center justify-center gap-4">
                            <AlertTriangle className="h-8 w-8 text-zinc-400" />
                            <p className="text-sm font-medium text-zinc-400">
                              {t("ipfsErrorTitle")}
                            </p>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={handleIframeRetry}
                                className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 border border-zinc-700 hover:bg-zinc-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                {t("ipfsRetry")}
                              </button>
                              <a
                                href={documentPreviewUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 font-medium text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                              >
                                {t("ipfsDownloadPdf")} <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        ) : iframeState === "offline" ? (
                          <div className="flex flex-col items-center justify-center gap-4">
                            <WifiOff className="h-8 w-8 text-amber-400" />
                            <p className="text-sm font-medium text-amber-300">
                              {t("ipfsOfflineTitle")}
                            </p>
                            <p className="text-xs text-zinc-500">{t("ipfsOfflineDesc")}</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-4">
                            <FileText className="h-10 w-10 text-zinc-500" />
                            <p className="text-sm font-medium text-zinc-400">
                              {t("pdfReady")}
                            </p>
                            <a
                              href={documentPreviewUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 font-medium text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                            >
                              {t("ipfsDownloadPdf")} <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-10 text-center">
                      <FileText className="h-8 w-8 text-zinc-600 mb-2" />
                      <p className="text-sm font-medium text-zinc-400">
                        {t("noDocumentTitle")}
                      </p>
                      <p className="text-xs text-zinc-600 mt-1">
                        {t("noDocumentDesc")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Metadata Viewer */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <InvoiceMetadataViewer invoice={invoice} isFunded={isFunded} />
            </motion.div>

            {/* Secondary Market Order Book Depth (#595) */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
            >
              <InvoiceOrderBookDepth
                invoiceTokenId={invoice.tokenId}
                currency={metadata.currency}
                positionFaceValue={terms.financingAmount}
              />
            </motion.div>
          </PrintLayout>

          {/* ── Right: Fund Panel ─────────────────────────────────────────── */}
          <div className="space-y-4" data-print-hide>
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <GlassCard className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-kora-400" />
                  <h2 className="font-semibold text-zinc-100">
                    Fund This Invoice
                  </h2>
                </div>

                {/* APR Metric Badge */}
                <div className="mb-6 rounded-lg bg-kora-500/5 border border-kora-500/10 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                      Expected APR
                    </p>
                    <p className="text-2xl font-bold text-kora-400 mt-0.5">
                      {formatApr(terms.apr)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                      Maturity
                    </p>
                    <div
                      className="text-xl font-bold text-zinc-200 mt-0.5 flex justify-end"
                      data-testid="maturity-countdown"
                    >
                      <CountdownTimer
                        targetDate={terms.repaymentDate}
                        compact={false}
                        invoice={invoice}
                        showCalendarExport
                        expiredLabel="Overdue"
                      />
                    </div>
                    {/* Backwards-compat test hook: keep numeric days for integration tests */}
                    <div data-testid="days-to-maturity" className="sr-only">
                      {daysToMaturity} days
                    </div>
                  </div>
                </div>

                {/* Wallet Not Connected Gate */}
                {!isConnected ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 p-4 text-center">
                      <p className="text-sm text-zinc-400">
                        Connect your Stellar wallet to view yields and start
                        investing.
                      </p>
                    </div>
                    <Button
                      className="w-full bg-kora-500 hover:bg-kora-600 text-white font-semibold"
                      size="lg"
                      onClick={() => setWalletModalOpen(true)}
                    >
                      Connect Wallet to Invest
                    </Button>
                  </div>
                ) : isSmeOwner ? (
                  /* SME Owner Self-Funding Lock Gate */
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-4 space-y-3">
                    <div className="flex gap-2.5 items-start">
                      <AlertTriangle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-yellow-400">
                          Self-Funding Blocked
                        </p>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                          You cannot fund your own invoice. Decoupled factoring
                          escrow rules restrict invoice owners from bidding as
                          liquidity providers.
                        </p>
                      </div>
                    </div>
                    <Button
                      className="w-full cursor-not-allowed"
                      variant="secondary"
                      disabled
                      size="lg"
                    >
                      You cannot fund your own invoice
                    </Button>

                    {/* Amendment panel — shown when invoice is still mutable (#568) */}
                    {canAmend(status) && (
                      <div className="mt-3 border-t border-yellow-500/10 pt-3">
                        {showAmendmentForm ? (
                          <InvoiceAmendmentForm
                            invoice={invoice}
                            ownerAddress={address ?? ""}
                            onSuccess={(newCid) => {
                              setShowAmendmentForm(false);
                            }}
                            onCancel={() => setShowAmendmentForm(false)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowAmendmentForm(true)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100 transition-colors"
                            data-testid="open-amendment-form"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Correct metadata
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : isFullyFunded ? (
                  /* Already Fully Funded Lock Gate */
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center space-y-3">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-bold text-emerald-400 text-sm">
                        Invoice Fully Funded
                      </p>
                      <p className="text-xs text-zinc-400 mt-1">
                        This invoice has completed its financing target and is
                        now locked in smart contract escrow.
                      </p>
                    </div>
                    <Button
                      className="w-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-not-allowed font-semibold"
                      disabled
                      size="lg"
                    >
                      Fully Funded
                    </Button>
                  </div>
                ) : (
                  /* Active Investor Funding Input Card */
                  <div className="space-y-4">
                    <div>
                      <Input
                        label="Investment Amount (USDC)"
                        type="number"
                        placeholder={`Min ${terms.minInvestment}`}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        hint={`Min: ${formatCurrency(terms.minInvestment, metadata.currency, true)} · Remaining Capacity: ${formatCurrency(fundingState.remainingCapacity, metadata.currency, true)}`}
                        disabled={funding}
                        className={cn(
                          (inputError || insufficientBalanceMessage) &&
                            "border-red-500 focus-visible:ring-red-500",
                        )}
                      />
                      {(inputError || insufficientBalanceMessage) && (
                        <p className="mt-1.5 text-xs text-red-400 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{" "}
                          {inputError || insufficientBalanceMessage}
                        </p>
                      )}
                    </div>

                    {showTestnetFaucet && (
                      <TestnetUsdcFaucet
                        compact
                        onSuccess={async () => {
                          await refetchUsdcBalance();
                        }}
                      />
                    )}

                    {/* FundingYieldCalculator — debounced, uses same APR formula */}
                    {!inputError && (
                      <FundingYieldCalculator
                        amountInput={amount}
                        apr={terms.apr}
                        daysToMaturity={daysToMaturity}
                        repaymentDate={terms.repaymentDate}
                        currency={metadata.currency}
                      />
                    )}

                    <Button
                      data-tour="fund-button"
                      className="w-full bg-kora-500 hover:bg-kora-600 text-white font-semibold shadow-lg shadow-kora-500/20"
                      size="lg"
                      onClick={handleFund}
                      loading={funding}
                      disabled={
                        !isOnline ||
                        !canFund ||
                        !!inputError ||
                        !!insufficientBalanceMessage ||
                        !amountNum
                      }
                    >
                      {!isOnline ? "Offline — Reconnect to Fund" : "Fund Invoice"}
                    </Button>

                    {!isOnline && (
                      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-amber-400">
                        <span aria-hidden="true">⚡</span>
                        You&apos;re offline. Reconnect to fund this invoice.
                      </p>
                    )}

                    <p className="text-center text-[10px] text-zinc-500 leading-normal">
                      Liquidity deposits are held securely in Soroban escrow
                      smart contracts until repayment is confirmed.
                    </p>
                  </div>
                )}
              </GlassCard>
            </motion.div>

            {/* Risk info */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-zinc-500" />
                  <p className="text-sm font-medium text-zinc-300">
                    Risk Assessment
                  </p>
                </div>
                <RiskScoreGauge
                  score={invoice.riskScore}
                  tier={riskTier}
                  factors={riskFactors}
                  trend={riskTrend}
                />
              </Card>
            </motion.div>

            {/* Fund Success Block */}
            {fundTxHash && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <GlassCard className="p-5 border-emerald-500/20 bg-emerald-500/5 space-y-2">
                  <div className="flex gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                    <div className="space-y-1 text-sm">
                      <p className="font-bold text-emerald-400">
                        Factoring escrow deposits funded!
                      </p>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Escrow deposit completed successfully. Your factoring
                        shares are logged under on-chain token state.
                      </p>
                      <div className="pt-2">
                        <a
                          href={safeStellarTxUrl(fundTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-kora-400 hover:text-kora-300 font-semibold"
                        >
                          <ExternalLink className="h-3 w-3" /> View transaction
                          on Stellar Expert
                        </a>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )}

            {/* On-chain info */}
            {invoice.txHash && (
              <motion.div
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="p-4">
                  <p className="mb-2 text-xs text-zinc-500">On-Chain</p>
                  <a
                    href={safeStellarTxUrl(invoice.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-kora-400 hover:text-kora-300"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View mint transaction
                  </a>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction simulation preview dialog */}
      <TxSimulationPreview {...simulationDialogProps} />
    </ErrorBoundary>
  );
}
