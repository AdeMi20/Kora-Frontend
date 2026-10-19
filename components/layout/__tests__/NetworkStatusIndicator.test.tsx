import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { NetworkStatusIndicator } from "../NetworkStatusIndicator";

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
  listQueuedXdrDrafts: vi.fn().mockResolvedValue([{ id: "draft-1" }, { id: "draft-2" }]),
  flushQueuedXdrDrafts: vi.fn(),
}));

vi.mock("@/lib/queryPersistence", () => ({
  getLatestMarketplaceDataUpdatedAt: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/layout/StaleDataBadge", () => ({
  StaleDataBadge: () => null,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

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
