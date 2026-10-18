import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { InvoiceOrderBookDepth } from "../InvoiceOrderBookDepth";
import {
  usePositionListingStore,
  type PositionListingMeta,
} from "@/store/positionListingStore";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function listing(
  positionId: string,
  askPrice: number,
  invoiceTokenId = "42"
): PositionListingMeta {
  return {
    positionId,
    askPrice,
    impliedDiscount: 0.05,
    listedAt: "2026-01-01T00:00:00.000Z",
    invoiceTokenId,
  };
}

const rows = () => screen.queryAllByRole("row").slice(1); // drop header row

describe("InvoiceOrderBookDepth store subscription", () => {
  beforeEach(() => {
    act(() => usePositionListingStore.setState({ listings: {} }));
  });

  it("shows the EmptyState when the invoice has no listings", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);
    expect(screen.getByText("empty.title")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("re-renders with a new listing without remounting", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);
    expect(rows()).toHaveLength(0);

    act(() => usePositionListingStore.getState().listPosition(listing("pos_a", 900)));

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("900");
  });

  it("ignores listings for other invoice tokens", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);

    act(() => {
      const { listPosition } = usePositionListingStore.getState();
      listPosition(listing("pos_other", 500, "99"));
      listPosition({ ...listing("pos_untagged", 600), invoiceTokenId: undefined });
    });

    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });

  it("re-sorts and recomputes cumulative volume when an askPrice changes", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);

    act(() => {
      const { listPosition } = usePositionListingStore.getState();
      listPosition(listing("pos_a", 900));
      listPosition(listing("pos_b", 950));
    });
    expect(rows()[0]).toHaveTextContent("900");
    expect(rows()[1]).toHaveTextContent("1,850");

    // Re-price pos_a above pos_b: pos_b becomes the best ask.
    act(() => usePositionListingStore.getState().listPosition(listing("pos_a", 1000)));

    expect(rows()[0]).toHaveTextContent("950");
    expect(rows()[0]).toHaveTextContent("best");
    expect(rows()[1]).toHaveTextContent("1,000");
    expect(rows()[1]).toHaveTextContent("1,950");
  });

  it("falls back to the EmptyState after the last delist", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);

    act(() => usePositionListingStore.getState().listPosition(listing("pos_a", 900)));
    expect(rows()).toHaveLength(1);

    act(() => usePositionListingStore.getState().unlistPosition("pos_a"));

    expect(screen.getByText("empty.title")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("exposes depth bars as progressbars with valuenow/min/max", () => {
    render(<InvoiceOrderBookDepth invoiceTokenId="42" />);

    act(() => {
      usePositionListingStore.getState().listPosition(listing("pos_a", 900));
      usePositionListingStore.getState().listPosition(listing("pos_b", 950));
    });

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
      expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(100);
    }
  });
});
