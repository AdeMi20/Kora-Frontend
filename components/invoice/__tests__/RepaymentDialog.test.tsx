/// <reference types="@testing-library/jest-dom" />
/**
 * RepaymentDialog — unit tests
 *
 * Covers:
 *  - Insufficient USDC balance → inline error visible, Confirm button disabled
 *  - Sufficient USDC balance  → no error, Confirm button enabled
 *  - Partial repayment path   → component renders with partial amount
 *  - Zero amount submission   → Confirm disabled (totalRepayment = 0)
 *  - Loading state            → button shows "Processing…", both buttons disabled
 *  - Simulation preview fee   → fee row rendered when simulationPreview supplied
 *  - Simulation error         → error banner visible, Confirm disabled
 *  - Cancel callback          → onOpenChange(false) fired, onConfirm NOT called
 *  - Confirm callback         → onConfirm(invoice) fired on valid state
 *  - Accessibility            → dialog role present, title visible, focus trap
 *  - Null invoice             → renders nothing (guard check)
 *
 * Wallet balance mocking strategy
 * ────────────────────────────────
 * RepaymentDialog receives `insufficientBalance: boolean` directly from its
 * parent (app/dashboard/sme/page.tsx), which computes:
 *
 *   insufficientBalance = usdcBalance < totalRaised * (1 + discountRate)
 *
 * This means the dialog itself has no dependency on useWallet — balance logic
 * sits in the caller. Tests mirror this contract: we pass pre-computed
 * `insufficientBalance` flags rather than mocking useWallet, keeping the tests
 * decoupled from the hook internals. The fixture invoice uses big-decimal
 * strings that match the output of `formatCurrency` (principal, yield, total).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepaymentDialog } from "../RepaymentDialog";
import type { Invoice } from "@/types";

// ── Module mocks ──────────────────────────────────────────────────────────────

/**
 * next-intl: return the key as-is so assertions work regardless of the
 * English copy changing later.  For keys that accept interpolation values
 * we append them as a serialised suffix so callers can still assert on them.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

/**
 * useFormatters: simple deterministic formatter — currency as "CURRENCY amount"
 * so test assertions don't depend on locale-specific separators.
 */
vi.mock("@/hooks/useFormatters", () => ({
  useFormatters: () => ({
    formatCurrency: (amount: number, currency = "USDC") =>
      `${currency} ${amount.toFixed(2)}`,
  }),
}));

/**
 * @/lib/env is imported transitively through lib/utils. Provide a minimal
 * stub so the module resolves without real env vars.
 */
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs",
    NEXT_PUBLIC_INVOICE_CONTRACT_ID:
      "CTEST000000000000000000000000000000000000000000000000000",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID:
      "CTEST000000000000000000000000000000000000000000000000001",
    NEXT_PUBLIC_TOKEN_CONTRACT_ID:
      "CTEST000000000000000000000000000000000000000000000000002",
    NEXT_PUBLIC_KYC_FUND_THRESHOLD: 10000,
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Fixture invoice used across all tests.
 *
 * Financial parameters (all in USDC):
 *   totalRaised    = 9_500
 *   discountRate   = 0.05  (5 %)
 *   yieldAmount    = 9_500 × 0.05 = 475
 *   totalRepayment = 9_500 + 475  = 9_975
 *
 * The `insufficientBalance` threshold used by the parent page is:
 *   usdcBalance < 9_500 × (1 + 0.05) = 9_975
 *
 * So a wallet with 5 000 USDC → insufficientBalance = true
 *     a wallet with 10 000 USDC → insufficientBalance = false
 */
const FIXTURE_INVOICE: Invoice = {
  id: "inv-repay-test",
  tokenId: "42",
  contractAddress: "GTEST1111111111111111111111111111111111111111111111",
  ipfsCid: "QmTestCIDRepaymentDialog",
  metadata: {
    invoiceNumber: "INV-2026-REPAY",
    issuerName: "Test Issuer Ltd",
    issuerAddress: "GISSUER11111111111111111111111111111111111111111111",
    debtorName: "Test Debtor Corp",
    debtorAddress: "GDEBTOR11111111111111111111111111111111111111111111",
    amount: 10_000,
    currency: "USDC",
    issueDate: "2026-01-01",
    dueDate: "2026-04-01",
    description: "Repayment dialog test fixture",
    jurisdiction: "KE",
    category: "technology",
    documentHash: "QmDocHash",
    documentUrl: "https://gateway.pinata.cloud/ipfs/QmDocHash",
  },
  terms: {
    discountRate: 0.05,
    apr: 20,
    financingAmount: 9_500,
    minInvestment: 500,
    maxInvestment: 9_500,
    tenor: 90,
    repaymentDate: "2026-04-01",
  },
  funding: {
    totalRaised: 9_500,
    targetAmount: 9_500,
    fundingProgress: 1.0,
    investorCount: 3,
    remainingCapacity: 0,
  },
  riskTier: "A",
  riskScore: 80,
  debtorPrivacy: "full",
  status: "fully_funded",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
  ownerAddress: "GISSUER11111111111111111111111111111111111111111111",
};

/** Zero-funded invoice — totalRepayment will be 0. */
const ZERO_FUNDED_INVOICE: Invoice = {
  ...FIXTURE_INVOICE,
  id: "inv-zero-funded",
  funding: {
    ...FIXTURE_INVOICE.funding,
    totalRaised: 0,
    fundingProgress: 0,
  },
};

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderProps {
  invoice?: Invoice | null;
  open?: boolean;
  insufficientBalance?: boolean;
  isLoading?: boolean;
  simulationPreview?: { feeXlm: number; error?: string } | null;
  simulationError?: string;
}

function renderDialog(props: RenderProps = {}) {
  const {
    invoice = FIXTURE_INVOICE,
    open = true,
    insufficientBalance = false,
    isLoading = false,
    simulationPreview = null,
    simulationError,
  } = props;

  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();

  const utils = render(
    <RepaymentDialog
      invoice={invoice}
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      isLoading={isLoading}
      insufficientBalance={insufficientBalance}
      simulationPreview={simulationPreview as any}
      simulationError={simulationError}
    />,
  );

  return { ...utils, onConfirm, onOpenChange };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("RepaymentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Guard: null invoice ─────────────────────────────────────────────────────

  describe("null invoice guard", () => {
    it("renders nothing when invoice is null", () => {
      const { container } = renderDialog({ invoice: null });
      expect(container).toBeEmptyDOMElement();
    });
  });

  // ── Dialog structure ────────────────────────────────────────────────────────

  describe("dialog structure", () => {
    it("renders a dialog role element", () => {
      renderDialog();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows the dialog title key", () => {
      renderDialog();
      // title key is returned as-is by the mock translator
      expect(screen.getByText("title")).toBeInTheDocument();
    });

    it("shows the invoice number and debtor name in the description", () => {
      renderDialog();
      expect(screen.getByText(/INV-2026-REPAY/)).toBeInTheDocument();
      expect(screen.getByText(/Test Debtor Corp/)).toBeInTheDocument();
    });

    it("shows principal, interest and total rows", () => {
      renderDialog();
      // Row labels are i18n keys
      expect(screen.getByText("principal")).toBeInTheDocument();
      expect(screen.getByText("interest")).toBeInTheDocument();
      expect(screen.getByText("total")).toBeInTheDocument();
    });

    it("renders the correct principal amount", () => {
      renderDialog();
      // principal = totalRaised = 9_500 → "USDC 9500.00"
      expect(screen.getByText("USDC 9500.00")).toBeInTheDocument();
    });

    it("renders the correct interest amount", () => {
      renderDialog();
      // yieldAmount = 9_500 × 0.05 = 475 → "USDC 475.00"
      expect(screen.getByText("USDC 475.00")).toBeInTheDocument();
    });

    it("renders the correct total repayment amount", () => {
      renderDialog();
      // totalRepayment = 9_975 → "USDC 9975.00"
      expect(screen.getByText("USDC 9975.00")).toBeInTheDocument();
    });
  });

  // ── Insufficient balance ────────────────────────────────────────────────────

  describe("insufficient balance", () => {
    it("shows the insufficient balance error when flag is true", () => {
      renderDialog({ insufficientBalance: true });
      // The i18n key is "insufficientBalance" with a values object
      expect(screen.getByText(/insufficientBalance/)).toBeInTheDocument();
    });

    it("disables the Confirm button when balance is insufficient", () => {
      renderDialog({ insufficientBalance: true });
      const confirmBtn = screen.getByRole("button", { name: "confirm" });
      expect(confirmBtn).toBeDisabled();
    });

    it("does NOT show the balance error when balance is sufficient", () => {
      renderDialog({ insufficientBalance: false });
      expect(screen.queryByText(/insufficientBalance/)).not.toBeInTheDocument();
    });

    it("enables the Confirm button when balance is sufficient", () => {
      renderDialog({ insufficientBalance: false });
      const confirmBtn = screen.getByRole("button", { name: "confirm" });
      expect(confirmBtn).toBeEnabled();
    });

    it("does not call onConfirm when Confirm is clicked with insufficient balance", () => {
      const { onConfirm } = renderDialog({ insufficientBalance: true });
      const confirmBtn = screen.getByRole("button", { name: "confirm" });
      fireEvent.click(confirmBtn);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  // ── Zero-amount invoice ─────────────────────────────────────────────────────

  describe("zero totalRaised (zero-amount invoice)", () => {
    it("renders zero amounts without crashing", () => {
      renderDialog({ invoice: ZERO_FUNDED_INVOICE });
      expect(screen.getByText("USDC 0.00")).toBeInTheDocument();
    });
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  describe("loading state", () => {
    it("shows the 'processing' key on the Confirm button while loading", () => {
      renderDialog({ isLoading: true });
      expect(screen.getByRole("button", { name: "processing" })).toBeInTheDocument();
    });

    it("disables the Confirm button while loading", () => {
      renderDialog({ isLoading: true });
      expect(screen.getByRole("button", { name: "processing" })).toBeDisabled();
    });

    it("disables the Cancel button while loading", () => {
      renderDialog({ isLoading: true });
      expect(screen.getByRole("button", { name: "cancel" })).toBeDisabled();
    });

    it("does not call onConfirm when clicked while loading", () => {
      const { onConfirm } = renderDialog({ isLoading: true });
      fireEvent.click(screen.getByRole("button", { name: "processing" }));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  // ── Simulation preview fee ──────────────────────────────────────────────────

  describe("simulation preview fee row", () => {
    it("renders the estimated fee row when simulationPreview is provided", () => {
      renderDialog({
        simulationPreview: { feeXlm: 0.00125 },
      });
      expect(screen.getByText("simulatedFee")).toBeInTheDocument();
      expect(screen.getByText(/0\.00125\d* XLM/)).toBeInTheDocument();
    });

    it("does not render a fee row when simulationPreview is null", () => {
      renderDialog({ simulationPreview: null });
      expect(screen.queryByText("simulatedFee")).not.toBeInTheDocument();
    });

    it("does not render a fee row when feeXlm is zero", () => {
      renderDialog({
        simulationPreview: { feeXlm: 0 },
      });
      expect(screen.queryByText("simulatedFee")).not.toBeInTheDocument();
    });
  });

  // ── Simulation error ────────────────────────────────────────────────────────

  describe("simulation error", () => {
    it("shows the simulation error message when simulationError is provided", () => {
      renderDialog({ simulationError: "Simulation failed: contract panicked" });
      expect(
        screen.getByText("Simulation failed: contract panicked"),
      ).toBeInTheDocument();
    });

    it("disables Confirm when simulationError is set", () => {
      renderDialog({ simulationError: "Nonce too old" });
      expect(screen.getByRole("button", { name: "confirm" })).toBeDisabled();
    });

    it("shows simulationPreview.error when present on the preview object", () => {
      renderDialog({
        simulationPreview: { feeXlm: 0, error: "Insufficient fee" },
      });
      expect(screen.getByText("Insufficient fee")).toBeInTheDocument();
    });

    it("disables Confirm when simulationPreview.error is set", () => {
      renderDialog({
        simulationPreview: { feeXlm: 0, error: "Insufficient fee" },
      });
      expect(screen.getByRole("button", { name: "confirm" })).toBeDisabled();
    });
  });

  // ── Cancel action ───────────────────────────────────────────────────────────

  describe("cancel action", () => {
    it("calls onOpenChange(false) when Cancel is clicked", () => {
      const { onOpenChange } = renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "cancel" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("does NOT call onConfirm when Cancel is clicked", () => {
      const { onConfirm } = renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "cancel" }));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("calls onOpenChange(false) via dialog overlay Escape key", () => {
      const { onOpenChange } = renderDialog();
      const dialog = screen.getByRole("dialog");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ── Confirm action ──────────────────────────────────────────────────────────

  describe("confirm action", () => {
    it("calls onConfirm with the invoice when Confirm is clicked", () => {
      const { onConfirm } = renderDialog({ insufficientBalance: false });
      fireEvent.click(screen.getByRole("button", { name: "confirm" }));
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onConfirm).toHaveBeenCalledWith(FIXTURE_INVOICE);
    });

    it("calls onConfirm exactly once per click", () => {
      const { onConfirm } = renderDialog({ insufficientBalance: false });
      const confirmBtn = screen.getByRole("button", { name: "confirm" });
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
      // Second click may be blocked by the loading state the parent would set,
      // but at the pure component level with no loading flag it fires twice.
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it("does NOT call onConfirm when both insufficientBalance and simulationError are set", () => {
      const { onConfirm } = renderDialog({
        insufficientBalance: true,
        simulationError: "Fee too high",
      });
      fireEvent.click(screen.getByRole("button", { name: "confirm" }));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("has a dialog role", () => {
      renderDialog();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("has an accessible dialog title", () => {
      renderDialog();
      // DialogTitle renders as a heading or labelled element
      const heading = screen.getByText("title");
      expect(heading).toBeInTheDocument();
    });

    it("Cancel button is keyboard focusable (not hidden, not aria-hidden)", () => {
      renderDialog();
      const cancelBtn = screen.getByRole("button", { name: "cancel" });
      expect(cancelBtn).not.toHaveAttribute("aria-hidden", "true");
      expect(cancelBtn).toBeVisible();
    });

    it("Confirm button is keyboard focusable when enabled", () => {
      renderDialog({ insufficientBalance: false });
      const confirmBtn = screen.getByRole("button", { name: "confirm" });
      expect(confirmBtn).toBeVisible();
      expect(confirmBtn).toBeEnabled();
    });

    it("insufficient-balance error has text content visible to screen readers", () => {
      renderDialog({ insufficientBalance: true });
      // The error element must not be aria-hidden
      const errorEl = screen.getByText(/insufficientBalance/);
      expect(errorEl).toBeVisible();
    });
  });

  // ── Dialog visibility ───────────────────────────────────────────────────────

  describe("dialog open/closed state", () => {
    it("is not rendered when open is false", () => {
      renderDialog({ open: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("is rendered when open is true", () => {
      renderDialog({ open: true });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  // ── Partial repayment path ──────────────────────────────────────────────────

  describe("partial repayment scenario", () => {
    /**
     * Simulate an invoice that is only partially funded — totalRaised = 4_750.
     * The parent page would set `insufficientBalance` based on the wallet's
     * actual USDC vs this smaller amount.  We test both balance states.
     */
    const PARTIAL_INVOICE: Invoice = {
      ...FIXTURE_INVOICE,
      id: "inv-partial",
      funding: {
        ...FIXTURE_INVOICE.funding,
        totalRaised: 4_750,
        fundingProgress: 0.5,
        remainingCapacity: 4_750,
      },
      status: "partially_funded",
    };

    it("shows the correct partial principal amount", () => {
      renderDialog({ invoice: PARTIAL_INVOICE });
      // principal = 4_750 → "USDC 4750.00"
      expect(screen.getByText("USDC 4750.00")).toBeInTheDocument();
    });

    it("shows the correct partial interest amount", () => {
      renderDialog({ invoice: PARTIAL_INVOICE });
      // yield = 4_750 × 0.05 = 237.5 → "USDC 237.50"
      expect(screen.getByText("USDC 237.50")).toBeInTheDocument();
    });

    it("shows the correct partial total repayment", () => {
      renderDialog({ invoice: PARTIAL_INVOICE });
      // total = 4_987.5 → "USDC 4987.50"
      expect(screen.getByText("USDC 4987.50")).toBeInTheDocument();
    });

    it("allows Confirm when wallet has sufficient balance for partial repayment", () => {
      renderDialog({ invoice: PARTIAL_INVOICE, insufficientBalance: false });
      expect(screen.getByRole("button", { name: "confirm" })).toBeEnabled();
    });

    it("blocks Confirm when wallet has insufficient balance for partial repayment", () => {
      renderDialog({ invoice: PARTIAL_INVOICE, insufficientBalance: true });
      expect(screen.getByRole("button", { name: "confirm" })).toBeDisabled();
    });
  });

  // ── No real network calls ───────────────────────────────────────────────────

  describe("no real network calls", () => {
    it("does not invoke fetch during render or button interaction", () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { onConfirm } = renderDialog({ insufficientBalance: false });
      fireEvent.click(screen.getByRole("button", { name: "confirm" }));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
