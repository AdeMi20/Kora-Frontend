import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ENABLE_MOCK_DATA: false },
}));

vi.mock("@/lib/stellar/contracts", () => ({
  getPositions: vi.fn(),
}));

vi.mock("@/services/invoiceService", () => ({
  fetchPositions: vi.fn(),
}));

const reconcileListings = vi.fn();
vi.mock("@/store/positionListingStore", () => ({
  usePositionListingStore: () => ({ reconcileListings }),
}));

import { getPositions } from "@/lib/stellar/contracts";
import { usePositions } from "@/hooks/usePositions";
import { queryKeyHierarchy, queryKeys } from "@/lib/queryKeys";

const ADDRESS = "GINVESTOR";

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const livePosition = {
  invoiceId: "inv-1",
  invoice: { id: "inv-1", createdAt: "2026-01-01T00:00:00Z" },
  investedAmount: 100,
  expectedReturn: 110,
  yieldEarned: 10,
  investedAt: "2026-01-02T00:00:00Z",
  status: "active",
};

describe("usePositions query key (#947)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPositions).mockResolvedValue([livePosition] as never);
  });

  it("caches positions under queryKeys.invoices.positions(address)", async () => {
    const client = makeClient();
    const { result } = renderHook(() => usePositions(ADDRESS), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(queryKeys.invoices.positions(ADDRESS))).toHaveLength(1);
    expect(client.getQueryData(["positions", ADDRESS])).toBeUndefined();
  });

  it("refetches when the positions prefix is invalidated", async () => {
    const client = makeClient();
    const { result } = renderHook(() => usePositions(ADDRESS), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getPositions).toHaveBeenCalledTimes(1);

    await act(() =>
      client.invalidateQueries({ queryKey: queryKeyHierarchy.invoices.positionsPrefix })
    );

    await waitFor(() => expect(getPositions).toHaveBeenCalledTimes(2));
  });

  it("does not fetch when the address is undefined", () => {
    const client = makeClient();
    const { result } = renderHook(() => usePositions(undefined), { wrapper: wrapper(client) });

    expect(result.current.fetchStatus).toBe("idle");
    expect(getPositions).not.toHaveBeenCalled();
  });

  it("does not fetch when the address is an empty string", () => {
    const client = makeClient();
    const { result } = renderHook(() => usePositions(""), { wrapper: wrapper(client) });

    expect(result.current.fetchStatus).toBe("idle");
    expect(getPositions).not.toHaveBeenCalled();
  });

  it("shares one cache entry between two consumers of the same address", async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => [usePositions(ADDRESS), usePositions(ADDRESS)] as const,
      { wrapper: wrapper(client) }
    );

    await waitFor(() => expect(result.current[0].isSuccess).toBe(true));

    const entries = client
      .getQueryCache()
      .findAll({ queryKey: queryKeyHierarchy.invoices.positionsPrefix });
    expect(entries).toHaveLength(1);
    expect(getPositions).toHaveBeenCalledTimes(1);
  });

});
