import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { ConcentrationRiskAlerts } from "../ConcentrationRiskAlerts";
import { useSettingsStore } from "@/store/settingsStore";
import type { ConcentrationPosition } from "@/lib/concentrationRisk";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ENABLE_MOCK_DATA: true },
}));

function position(
  investedAmount: number,
  riskTier: string,
  jurisdiction: string,
  debtorName: string
): ConcentrationPosition {
  return { investedAmount, invoice: { riskTier, metadata: { jurisdiction, debtorName } } };
}

describe("ConcentrationRiskAlerts marketplace CTA (#944)", () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      concentration: { ...s.concentration, dismissedKeys: [], snoozes: [] },
    }));
  });

  it("links each alert to the marketplace with diversification filters", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConcentrationRiskAlerts
          positions={[position(900, "BBB", "NG", "Acme"), position(100, "AA", "US", "Beta")]}
        />
      </NextIntlClientProvider>
    );

    const tierLink = screen.getByTestId("concentration-cta-riskTier:BBB");
    expect(tierLink).toHaveTextContent(en.concentrationRisk.diversifyCta);
    const tierHref = new URL(tierLink.getAttribute("href")!, "http://localhost");
    expect(tierHref.pathname).toBe("/marketplace");
    expect(tierHref.searchParams.get("riskTiers")?.split(",")).not.toContain("BBB");
    expect(tierHref.searchParams.get("source")).toBe("concentration_cta");

    // Debtors have no marketplace filter: fall back to the unfiltered marketplace.
    expect(screen.getByTestId("concentration-cta-debtor:Acme")).toHaveAttribute(
      "href",
      "/marketplace?source=concentration_cta"
    );
  });
});
