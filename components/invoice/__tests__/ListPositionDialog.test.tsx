import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { ListPositionDialog } from "@/components/invoice/ListPositionDialog";
import InvestorDashboardPage from "@/app/dashboard/investor/page";
import { usePositionListingStore } from "@/store/positionListingStore";
import type { InvestorPosition } from "@/types/invoice";

const mocks = vi.hoisted(() => ({
  wallet: { isConnected: true, address: "GINVESTOR" as string | null },
  positions: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ENABLE_MOCK_DATA: true },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard/investor",
  useSearchParams: () => new URLSearchParams(),
}));

// Resolve `next/dynamic` loaders on mount so the real DataTable renders.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
    return function Dynamic(props: Record<string, unknown>) {
      const [Comp, setComp] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
      React.useEffect(() => {
        void loader().then((c) => setComp(() => c));
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
  },
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("@/hooks/usePositions", () => ({
  usePositions: () => ({
    data: mocks.positions,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

vi.mock("@/hooks/useTransaction", () => ({
  useTransaction: () => ({ execute: vi.fn() }),
}));

vi.mock("@/hooks/useTxSimulation", () => ({
  useTxSimulation: () => ({ simulationDialogProps: {}, onSimulationPreview: vi.fn() }),
}));

vi.mock("@/hooks/useVerifiedAction", () => ({
  useVerifiedAction: () => ({ executeProtectedAction: vi.fn() }),
}));

vi.mock("@/services/invoiceService", () => ({
  prepareClaimPosition: vi.fn(),
}));

// Sections of the dashboard unrelated to the listing flow.
vi.mock("@/components/dashboard/PortfolioDonut", () => ({ PortfolioDonut: () => null }));
vi.mock("@/components/dashboard/KycStatusCard", () => ({ KycStatusCard: () => null }));
vi.mock("@/components/analytics/ConcentrationRiskAlerts", () => ({
  ConcentrationRiskAlerts: () => null,
}));
vi.mock("@/components/layout/StaleDataBadge", () => ({ StaleDataBadge: () => null }));
vi.mock("@/components/invoice/TxSimulationPreview", () => ({ TxSimulationPreview: () => null }));

function makePosition(overrides: Partial<InvestorPosition> = {}): InvestorPosition {
  return {
    id: "pos_123",
    invoiceId: "inv_123",
    investedAmount: 1000,
    expectedReturn: 1100,
    yieldEarned: 100,
    investedAt: "2026-01-01T00:00:00Z",
    status: "active",
    invoice: {
      id: "inv_123",
      tokenId: "123",
      metadata: {
        invoiceNumber: "INV-001",
        debtorName: "Debtor Inc",
        currency: "USDC",
        jurisdiction: "US",
        category: "technology",
      },
      terms: { apr: 10, repaymentDate: "2027-01-01T00:00:00Z" },
      riskTier: "A",
      createdAt: "2026-01-01T00:00:00Z",
    } as unknown as InvestorPosition["invoice"],
    ...overrides,
  };
}

// onError is silenced because some dashboard sections (stats, error copy) still
// reference keys missing from en.json; the listing flow asserts on real copy.
function withIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} onError={() => {}}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ListPositionDialog", () => {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();

  function renderDialog(position: InvestorPosition | null = makePosition()) {
    return withIntl(
      <ListPositionDialog
        position={position}
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />
    );
  }

  it("renders the dialog with the expected return", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: /list position for sale/i });
    expect(dialog).toHaveTextContent(/Expected return:.*1,100/);
  });

  it("renders nothing when position is null", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps submit disabled until a valid ask price is entered", async () => {
    const user = userEvent.setup();
    renderDialog();
    const submit = screen.getByRole("button", { name: "List for sale" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Ask price"), "1000");
    expect(submit).toBeEnabled();
  });

  it("shows a range error when the ask price is too low or too high", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("Ask price");

    await user.type(input, "50");
    expect(screen.getByText(/Ask price must be between/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List for sale" })).toBeDisabled();

    await user.clear(input);
    await user.type(input, "3000");
    expect(screen.getByText(/Ask price must be between/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("previews the implied discount or premium", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("Ask price");

    await user.type(input, "1000");
    expect(screen.getByText("Implied discount")).toBeInTheDocument();
    expect(
      screen.getByText("Buyer receives a discount versus your expected return.")
    ).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "1200");
    expect(
      screen.getByText("You're asking above your expected return (premium).")
    ).toBeInTheDocument();
  });

  it("submits the parsed ask price and resets the input", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("Ask price");

    await user.type(input, "1000");
    await user.click(screen.getByRole("button", { name: "List for sale" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(1000, undefined);
    expect(input).toHaveValue(null);
  });

  it("calls onOpenChange(false) on cancel", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ListPositionDialog on the investor dashboard (#945)", () => {
  beforeEach(() => {
    mocks.wallet = { isConnected: true, address: "GINVESTOR" };
    mocks.positions = [makePosition()];
    act(() => usePositionListingStore.setState({ listings: {} }));
  });

  async function openFromRow(user: ReturnType<typeof userEvent.setup>) {
    withIntl(<InvestorDashboardPage />);
    const listButton = await screen.findByRole("button", {
      name: en.investorDashboard.table.listForSale,
    });
    await user.click(listButton);
    return screen.findByRole("dialog", { name: /list position for sale/i });
  }

  it("opens from a position row, validates, lists to the store and closes", async () => {
    const user = userEvent.setup();
    const dialog = await openFromRow(user);
    const input = within(dialog).getByLabelText("Ask price");
    const submit = within(dialog).getByRole("button", { name: "List for sale" });

    // Invalid ask price: error shown, nothing reaches the store.
    await user.type(input, "50");
    expect(within(dialog).getByText(/Ask price must be between/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(usePositionListingStore.getState().listings).toEqual({});

    await user.clear(input);
    await user.type(input, "1000");
    await user.click(submit);

    const [listing] = usePositionListingStore.getState().getListingsByInvoiceToken("123");
    expect(listing).toMatchObject({
      positionId: "pos_123",
      askPrice: 1000,
      invoiceTokenId: "123",
      repaymentDate: "2027-01-01T00:00:00Z",
      ownershipConfirmed: true,
    });
    expect(listing.impliedDiscount).toBeCloseTo(100 / 1100);
    expect(Number.isNaN(Date.parse(listing.listedAt))).toBe(false);

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(en.investorDashboard.listing.success);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The row now offers to unlist instead of creating a second listing.
    expect(
      screen.getByRole("button", { name: en.investorDashboard.table.unlist })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.investorDashboard.table.listForSale })
    ).not.toBeInTheDocument();
  });

  it("closes without listing when cancelled", async () => {
    const user = userEvent.setup();
    const dialog = await openFromRow(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(usePositionListingStore.getState().listings).toEqual({});
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("offers no listing action while the wallet is disconnected", () => {
    mocks.wallet = { isConnected: false, address: null };
    withIntl(<InvestorDashboardPage />);

    expect(
      screen.queryByRole("button", { name: en.investorDashboard.table.listForSale })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.common.connectWallet })).toBeInTheDocument();
  });
});
