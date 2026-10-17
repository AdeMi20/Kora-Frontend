/**
 * app/transactions/loading.tsx — route loading skeleton (#932).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TransactionsLoading from "@/app/transactions/loading";

describe("TransactionsLoading", () => {
  it("announces a busy status region", () => {
    render(<TransactionsLoading />);
    const status = screen.getByRole("status", { name: /loading transaction history/i });
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("mirrors the page: four stat cards and stacked transaction rows", () => {
    const { container } = render(<TransactionsLoading />);
    expect(container.querySelectorAll(".lg\\:grid-cols-4 > div")).toHaveLength(4);
    expect(screen.getAllByTestId("tx-row-skeleton")).toHaveLength(5);
  });
});
