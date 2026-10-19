import { render, screen, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { NetworkStatusIndicator } from "../NetworkStatusIndicator";
import { listQueuedXdrDrafts, type QueuedXdrDraft } from "@/lib/xdrDraftQueue";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({
    health: {
      overall: "operational",
      soroban: { status: "operational", responseTime: 120, lastChecked: new Date() },
      horizon: { status: "operational", responseTime: 80, lastChecked: new Date() },
      network: "testnet",
    },
    isOnline: true,
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("@/lib/xdrDraftQueue", () => ({
  listQueuedXdrDrafts: vi.fn(),
  flushQueuedXdrDrafts: vi.fn(),
}));

vi.mock("@/lib/queryPersistence", () => ({
  getLatestMarketplaceDataUpdatedAt: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/layout/StaleDataBadge", () => ({
  StaleDataBadge: () => null,
}));

// Radix tooltip content only mounts while open (and needs layout APIs jsdom
// lacks). Render it inline so the tooltip's /offline link can be asserted.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipRoot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockList = vi.mocked(listQueuedXdrDrafts);

function drafts(count: number): QueuedXdrDraft[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `draft-${i + 1}`,
    signedXdr: "AAAA",
    meta: {},
    queuedAt: 0,
    attempts: 0,
  }));
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function fireOnline() {
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue(drafts(2));
});

describe("NetworkStatusIndicator", () => {
  it("renders network status indicator element", () => {
    render(<NetworkStatusIndicator />, { wrapper });
    expect(screen.getByTestId("network-status-indicator")).toBeInTheDocument();
  });

  it("shows a badge when the queue has pending drafts", async () => {
    render(<NetworkStatusIndicator />, { wrapper });
    // listQueuedXdrDrafts resolves with 2 items; badge should appear after resolution
    const badge = await screen.findByTestId("queue-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });
});

describe("NetworkStatusIndicator — queued XDR badge", () => {
  it("hides the badge and tooltip link when the queue is empty (0)", async () => {
    mockList.mockResolvedValue([]);
    render(<NetworkStatusIndicator />, { wrapper });

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByTestId("queue-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("queue-tooltip-link")).not.toBeInTheDocument();
  });

  it("uses a singular aria-label for one pending draft (1)", async () => {
    mockList.mockResolvedValue(drafts(1));
    render(<NetworkStatusIndicator />, { wrapper });

    const badge = await screen.findByTestId("queue-badge");
    expect(badge).toHaveTextContent("1");
    expect(badge).toHaveAttribute("aria-label", "1 pending transaction");
    expect(screen.getByRole("link", { name: /1 signed transaction pending/ })).toBeInTheDocument();
  });

  it("uses a plural aria-label for several pending drafts (N)", async () => {
    mockList.mockResolvedValue(drafts(5));
    render(<NetworkStatusIndicator />, { wrapper });

    const badge = await screen.findByTestId("queue-badge");
    expect(badge).toHaveTextContent("5");
    expect(badge).toHaveAttribute("aria-label", "5 pending transactions");
    expect(screen.getByLabelText("5 pending transactions")).toBe(badge);
    expect(screen.getByRole("link", { name: /5 signed transactions pending/ })).toBeInTheDocument();
  });

  it("links the tooltip to the /offline queue page", async () => {
    render(<NetworkStatusIndicator />, { wrapper });

    const link = await screen.findByTestId("queue-tooltip-link");
    expect(link).toHaveAttribute("href", "/offline");
    expect(screen.getByTestId("tooltip-content")).toContainElement(link);
  });

  it("caps the visible count at 99+ but keeps the exact count for screen readers", async () => {
    mockList.mockResolvedValue(drafts(150));
    render(<NetworkStatusIndicator />, { wrapper });

    const badge = await screen.findByTestId("queue-badge");
    expect(badge).toHaveTextContent("99+");
    expect(badge).toHaveAttribute("aria-label", "150 pending transactions");
    expect(screen.getByTestId("queue-tooltip-link")).toHaveTextContent(
      "150 signed transactions pending",
    );
  });

  it("re-fetches the queue on the window online event and clears the badge once empty", async () => {
    mockList.mockResolvedValueOnce(drafts(2)).mockResolvedValue([]);
    render(<NetworkStatusIndicator />, { wrapper });

    expect(await screen.findByTestId("queue-badge")).toHaveTextContent("2");
    expect(mockList).toHaveBeenCalledTimes(1);

    fireOnline();

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("queue-badge")).not.toBeInTheDocument());
    expect(screen.queryByTestId("queue-tooltip-link")).not.toBeInTheDocument();
  });

  it("updates the count on reconnect when drafts remain queued", async () => {
    mockList.mockResolvedValueOnce(drafts(3)).mockResolvedValue(drafts(1));
    render(<NetworkStatusIndicator />, { wrapper });

    expect(await screen.findByTestId("queue-badge")).toHaveTextContent("3");

    fireOnline();

    await waitFor(() =>
      expect(screen.getByTestId("queue-badge")).toHaveAttribute(
        "aria-label",
        "1 pending transaction",
      ),
    );
  });

  it("stops listening for online events after unmount", async () => {
    const { unmount } = render(<NetworkStatusIndicator />, { wrapper });
    await screen.findByTestId("queue-badge");
    unmount();

    mockList.mockClear();
    fireOnline();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("renders without a badge when listQueuedXdrDrafts throws", async () => {
    mockList.mockRejectedValue(new Error("IndexedDB unavailable"));
    render(<NetworkStatusIndicator />, { wrapper });

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.getByTestId("network-status-indicator")).toBeInTheDocument();
    expect(screen.queryByTestId("queue-badge")).not.toBeInTheDocument();
  });
});
