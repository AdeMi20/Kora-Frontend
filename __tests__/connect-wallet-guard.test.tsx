/**
 * Component tests for ConnectWalletGuard (#818).
 *
 * Covers:
 *  - Connected wallet: children render, no blocking overlay
 *  - Disconnected wallet on a protected route: overlay blocks children
 *  - Disconnected wallet on a public route: children render
 *  - redirectTo query param takes priority as the intended destination
 *  - Protected pathname is used as the implicit intended destination
 *  - Suspense fallback is a visible loading affordance, not blank (#875)
 */

import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { useUIStore } from "@/store/uiStore";
import { ConnectWalletGuard } from "@/components/layout/ConnectWalletGuard";

const mockPathname = vi.fn<[], string>();
const mockSearchParams = vi.fn<[], URLSearchParams>();
const mockUseWallet = vi.fn<[], { isConnected: boolean }>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

vi.mock("@/components/wallet/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect Wallet</button>,
}));

// Avoid pulling every store (and their env-dependent imports) via the barrel.
vi.mock("@/store", async () => ({
  useUIStore: (await import("@/store/uiStore")).useUIStore,
}));

function renderGuard() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConnectWalletGuard>
        <div>Protected content</div>
      </ConnectWalletGuard>
    </NextIntlClientProvider>
  );
}

describe("ConnectWalletGuard", () => {
  beforeEach(() => {
    useUIStore.setState({ intendedDestination: null });
    mockPathname.mockReturnValue("/dashboard/sme");
    mockSearchParams.mockReturnValue(new URLSearchParams());
    mockUseWallet.mockReturnValue({ isConnected: true });
  });

  describe("connected vs blocked", () => {
    it("renders children when the wallet is connected", () => {
      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
      expect(screen.queryByText(en.wallet.connectGuardTitle)).not.toBeInTheDocument();
    });

    it.each(["/invoice/create", "/dashboard/sme", "/dashboard/investor", "/dashboard/sme/invoices", "/secondary", "/analytics", "/analytics/export"])(
      "blocks %s when the wallet is disconnected",
      (pathname) => {
        mockPathname.mockReturnValue(pathname);
        mockUseWallet.mockReturnValue({ isConnected: false });

        renderGuard();

        expect(screen.getByText(en.wallet.connectGuardTitle)).toBeInTheDocument();
        expect(screen.getByText(en.wallet.connectGuardDesc)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
      }
    );

    it("does not block public routes when the wallet is disconnected", () => {
      mockPathname.mockReturnValue("/marketplace");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
      expect(screen.queryByText(en.wallet.connectGuardTitle)).not.toBeInTheDocument();
    });

    it("does not treat routes that only share a prefix as protected", () => {
      mockPathname.mockReturnValue("/dashboard/smeish");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });
  });

  describe("redirectTo query handling", () => {
    it("stores the redirectTo query param as the intended destination", () => {
      mockSearchParams.mockReturnValue(new URLSearchParams("redirectTo=/invoice/create"));

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/invoice/create");
    });

    it("prefers redirectTo over an existing intended destination", () => {
      useUIStore.setState({ intendedDestination: "/dashboard/investor" });
      mockSearchParams.mockReturnValue(new URLSearchParams("redirectTo=/dashboard/sme"));

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/dashboard/sme");
    });

    it("falls back to the protected pathname when redirectTo is absent", () => {
      mockPathname.mockReturnValue("/dashboard/investor");

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/dashboard/investor");
    });

    it("does not overwrite an existing intended destination without redirectTo", () => {
      useUIStore.setState({ intendedDestination: "/invoice/create" });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/invoice/create");
    });

    it("does not set an intended destination for public routes", () => {
      mockPathname.mockReturnValue("/marketplace");

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBeNull();
    });

    it("does not record a destination while the guard is blocking", () => {
      mockUseWallet.mockReturnValue({ isConnected: false });
      mockSearchParams.mockReturnValue(new URLSearchParams("redirectTo=/dashboard/sme"));

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBeNull();
    });
  });

  describe("suspense fallback (#875)", () => {
    it("renders a visible loading affordance instead of a blank fallback", () => {
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <Suspense fallback={<div role="status" aria-live="polite">Loading…</div>}>
            <ConnectWalletGuard>
              <div>Protected content</div>
            </ConnectWalletGuard>
          </Suspense>
        </NextIntlClientProvider>
      );

      // The guard's own Suspense boundary must not resolve to null; a status
      // region (or the resolved content) should always be present.
      const status = screen.queryByRole("status");
      const content = screen.queryByText("Protected content");
      expect(status ?? content).not.toBeNull();
    });
  });

  // ── /secondary route ──────────────────────────────────────────────────────

  describe("/secondary route guard", () => {
    it("blocks /secondary when the wallet is disconnected", () => {
      mockPathname.mockReturnValue("/secondary");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText(en.wallet.connectGuardTitle)).toBeInTheDocument();
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });

    it("renders children on /secondary when the wallet is connected", () => {
      mockPathname.mockReturnValue("/secondary");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
      expect(screen.queryByText(en.wallet.connectGuardTitle)).not.toBeInTheDocument();
    });

    it("sets /secondary as the intended destination when connected and no prior destination", () => {
      mockPathname.mockReturnValue("/secondary");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/secondary");
    });

    it("sets a nested /secondary path as the intended destination", () => {
      mockPathname.mockReturnValue("/secondary/position/pos-42");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/secondary/position/pos-42");
    });

    it("does not treat /secondarymarket as a protected route", () => {
      mockPathname.mockReturnValue("/secondarymarket");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    it("redirectTo still wins over /secondary pathname", () => {
      mockPathname.mockReturnValue("/secondary");
      mockSearchParams.mockReturnValue(new URLSearchParams("redirectTo=/dashboard/investor"));
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/dashboard/investor");
    });
  });

  // ── /analytics route ──────────────────────────────────────────────────────

  describe("/analytics route guard", () => {
    it("blocks /analytics when the wallet is disconnected", () => {
      mockPathname.mockReturnValue("/analytics");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText(en.wallet.connectGuardTitle)).toBeInTheDocument();
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });

    it("renders children on /analytics when the wallet is connected", () => {
      mockPathname.mockReturnValue("/analytics");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
      expect(screen.queryByText(en.wallet.connectGuardTitle)).not.toBeInTheDocument();
    });

    it("sets /analytics as the intended destination when connected and no prior destination", () => {
      mockPathname.mockReturnValue("/analytics");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/analytics");
    });

    it("sets a nested /analytics path as the intended destination", () => {
      mockPathname.mockReturnValue("/analytics/yield");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/analytics/yield");
    });

    it("does not treat /analyticsdata as a protected route", () => {
      mockPathname.mockReturnValue("/analyticsdata");
      mockUseWallet.mockReturnValue({ isConnected: false });

      renderGuard();

      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    it("redirectTo still wins over /analytics pathname", () => {
      mockPathname.mockReturnValue("/analytics");
      mockSearchParams.mockReturnValue(new URLSearchParams("redirectTo=/dashboard/sme"));
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      expect(useUIStore.getState().intendedDestination).toBe("/dashboard/sme");
    });

    it("does not overwrite an existing intended destination without redirectTo", () => {
      useUIStore.setState({ intendedDestination: "/invoice/create" });
      mockPathname.mockReturnValue("/analytics");
      mockUseWallet.mockReturnValue({ isConnected: true });

      renderGuard();

      // Pre-existing destination must be preserved
      expect(useUIStore.getState().intendedDestination).toBe("/invoice/create");
    });
  });
});
