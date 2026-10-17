import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  InvestorDashboardSkeleton,
  PortfolioDonutSkeleton,
  StatCardSkeleton,
} from "@/components/ui/skeleton";
import InvestorDashboardLoading from "@/app/dashboard/investor/loading";

describe("Investor dashboard skeleton loading", () => {
  it("renders InvestorDashboardSkeleton with aria-busy and role=status", () => {
    render(<InvestorDashboardSkeleton />);
    const root = screen.getByRole("status", { name: /loading investor dashboard/i });
    expect(root).toHaveAttribute("aria-busy", "true");
  });

  it("loads the route loading module and resolves the skeleton from @/components/ui/skeleton", () => {
    // The route `loading.tsx` used to import a non-existent
    // `@/components/dashboard/InvestorDashboardSkeleton`; importing this module
    // fails loudly if the path regresses, and rendering proves the export name
    // matches what `page.tsx` consumes.
    expect(typeof InvestorDashboardLoading).toBe("function");

    render(<InvestorDashboardLoading />);

    expect(
      screen.getByRole("status", { name: /loading investor dashboard/i }),
    ).toBeInTheDocument();
  });

  it("renders PortfolioDonutSkeleton with aria-busy", () => {
    const { container } = render(<PortfolioDonutSkeleton />);
    const busy = container.querySelector("[aria-busy='true']");
    expect(busy).toBeTruthy();
    expect(busy).toHaveAttribute("aria-label", "Loading portfolio composition");
  });

  it("renders StatCardSkeleton blocks matching card dimensions", () => {
    const { container } = render(<StatCardSkeleton />);
    expect(container.firstChild).toHaveClass("rounded-xl", "border", "p-5");
  });
});
