/**
 * Tests for app/transactions/page.tsx
 *
 * Covers:
 *  - Connect-wallet gate
 *  - Empty state
 *  - Type / status filters
 *  - CSV export
 *  - ErrorBoundary: forced child throw renders compact fallback instead of
 *    white-screening the entire page (acceptance criterion for the
 *    ErrorBoundary-for-transactions feature).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Env mock (must come first) ────────────────────────────────────────────────
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
    NEXT_PUBLIC_INVOICE_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_TOKEN_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  },
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("@/lib/security", () => ({
  safeStellarTxUrl: (hash: string) =>
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    // Return leaf key for predictable assertions
    const leaf = key.split(".").pop() ?? key;
    // Provide the values the page actually renders
    const map: Record<string, string> = {
      title: "Transaction History",
      subtitle: "Your complete on-chain activity on Kora Protocol",
      exportCsv: "Export CSV",
      clearAll: "Clear All",
      connectTitle: "Connect your wallet",
      connectDesc: "Connect to view your on-chain transaction history",
      searchPlaceholder: "Search…",
      clearSearch: "Clear search",
      noResults: "No results",
      noResultsDesc: "Try adjusting your search or filters",
      listTitle: "Transactions",
      "empty.title": "No transactions yet",
      "empty.description": "Your on-chain activity will appear here once you mint, fund, or repay invoices.",
      all: "All Types",
      mint: "Mints",
      fund: "Funding",
      repay: "Repayments",
      claim: "Claims",
      confirmed: "confirmed",
      failed: "failed",
      searchAria: "Search transactions",
      typeFilterAria: "Filter by transaction type",
      statusFilterAria: "Filter by status",
    };
    return map[key] ?? map[leaf] ?? key;
  },
  // useFormatters internally calls useFormatter from next-intl
  useFormatter: () => ({
    number: (value: number) => String(value),
    dateTime: (date: Date) => date.toISOString(),
  }),
}));

// LocaleProvider's useLocale must also be mocked
vi.mock("@/i18n/LocaleProvider", () => ({
  useLocale: () => "en",
}));

// ── Store mock — use real zustand so state mutations work ─────────────────────
vi.mock("@/store", async () => {
  const { create } = await import("zustand");

  const useTransactionStore = create<any>()((set: any) => ({
    transactions: [],
    addTransaction: (tx: any) =>
      set((s: any) => ({ transactions: [tx, ...s.transactions] })),
    removeTransaction: (hash: string) =>
      set((s: any) => ({
        transactions: s.transactions.filter((t: any) => t.hash !== hash),
      })),
    clearHistory: () => set({ transactions: [] }),
  }));

  const useUIStore = create<any>()((set: any) => ({
    walletModalOpen: false,
    setWalletModalOpen: (open: boolean) => set({ walletModalOpen: open }),
  }));

  return { useTransactionStore, useUIStore };
});

// After mocks:
import TransactionHistoryPage from "../page";
import { useWallet } from "@/hooks/useWallet";
import { useTransactionStore } from "@/store";
import { ErrorBoundary } from "@/components/ui/error-boundary";

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectedWallet() {
  vi.mocked(useWallet).mockReturnValue({
    isConnected: true,
    address: "GTEST123",
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as any);
}

function disconnectedWallet() {
  vi.mocked(useWallet).mockReturnValue({
    isConnected: false,
    address: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as any);
}

const MINT_TX = {
  hash: "hash_mint_001",
  type: "mint" as const,
  status: "confirmed" as const,
  invoiceNumber: "INV-001",
  description: "Mint invoice #1",
  amount: 100,
  currency: "USDC",
  timestamp: new Date("2026-07-28T12:00:00Z").toISOString(),
};

const FUND_TX = {
  hash: "hash_fund_002",
  type: "fund" as const,
  status: "confirmed" as const,
  invoiceNumber: "INV-002",
  description: "Fund invoice #2",
  amount: 200,
  currency: "USDC",
  timestamp: new Date("2026-07-29T12:00:00Z").toISOString(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionHistoryPage", () => {
  beforeEach(() => {
    useTransactionStore.setState({ transactions: [] });
  });

  // ── Connect-wallet gate ─────────────────────────────────────────────────────
  describe("when wallet is disconnected", () => {
    it("renders connect-wallet prompt", () => {
      disconnectedWallet();
      render(<TransactionHistoryPage />);

      // Both heading and button say "Connect your wallet" — check for the heading
      expect(screen.getByRole("heading", { name: "Connect your wallet" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect your wallet/i })).toBeInTheDocument();
    });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────
  describe("when connected with no transactions", () => {
    it("renders page title and empty state", () => {
      connectedWallet();
      render(<TransactionHistoryPage />);

      expect(screen.getByText("Transaction History")).toBeInTheDocument();
      expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    });

    it("export button is disabled when transaction list is empty", () => {
      connectedWallet();
      render(<TransactionHistoryPage />);

      expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
    });
  });

  // ── Populated list ──────────────────────────────────────────────────────────
  describe("when connected with transactions", () => {
    beforeEach(() => {
      connectedWallet();
      useTransactionStore.setState({ transactions: [MINT_TX, FUND_TX] });
    });

    it("shows all transactions initially", () => {
      render(<TransactionHistoryPage />);

      expect(screen.getByText("INV-001")).toBeInTheDocument();
      expect(screen.getByText("INV-002")).toBeInTheDocument();
    });

    it("filters to mint type only", () => {
      render(<TransactionHistoryPage />);

      fireEvent.click(screen.getByRole("button", { name: /^mints$/i }));

      expect(screen.getByText("INV-001")).toBeInTheDocument();
      expect(screen.queryByText("INV-002")).not.toBeInTheDocument();
    });

    it("filters to funding type only", () => {
      render(<TransactionHistoryPage />);

      fireEvent.click(screen.getByRole("button", { name: /^funding$/i }));

      expect(screen.queryByText("INV-001")).not.toBeInTheDocument();
      expect(screen.getByText("INV-002")).toBeInTheDocument();
    });

    it("search filters transactions by invoice number", () => {
      render(<TransactionHistoryPage />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "INV-001" } });

      expect(screen.getByText("INV-001")).toBeInTheDocument();
      expect(screen.queryByText("INV-002")).not.toBeInTheDocument();
    });

    it("shows no-results state when search matches nothing", () => {
      render(<TransactionHistoryPage />);

      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "NOMATCH_ZZZZZ" },
      });

      expect(screen.getByText("No results")).toBeInTheDocument();
    });
  });

  // ── ErrorBoundary: forced child failure ─────────────────────────────────────
  describe("ErrorBoundary fallback", () => {
    // Suppress the jsdom error console noise from the throwing component.
    const consoleError = console.error;
    beforeEach(() => {
      console.error = vi.fn();
    });
    afterEach(() => {
      console.error = consoleError;
    });

    it("shows compact error fallback instead of white-screening when a child throws", () => {
      function ThrowingChild() {
        throw new Error("Simulated render failure");
      }

      render(
        <ErrorBoundary compact>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      // Compact fallback: shows a short error label, not a full blank page
      expect(screen.getByText(/connection error|contract error|something went wrong/i)).toBeInTheDocument();
      // Retry button available
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("retry resets the boundary so the child can re-render", () => {
      let shouldThrow = true;

      function MaybeThrow() {
        if (shouldThrow) throw new Error("Boom");
        return <p>Recovered</p>;
      }

      const { rerender } = render(
        <ErrorBoundary compact>
          <MaybeThrow />
        </ErrorBoundary>,
      );

      // Fallback is shown
      const retryBtn = screen.getByRole("button", { name: /retry/i });
      expect(retryBtn).toBeInTheDocument();

      // Clear the error condition then click retry
      shouldThrow = false;
      fireEvent.click(retryBtn);

      rerender(
        <ErrorBoundary compact>
          <MaybeThrow />
        </ErrorBoundary>,
      );

      expect(screen.getByText("Recovered")).toBeInTheDocument();
    });
  });
});
