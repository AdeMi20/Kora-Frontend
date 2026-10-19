/**
 * Component tests for WalletConnectModal — Issue #1026.
 *
 * Covers:
 *  - Opening the modal from the uiStore trigger and its accessible name
 *  - Stable provider ordering and aria labels on provider actions
 *  - Unavailable-extension messaging (install links, health badges)
 *  - Connection error + retry UI, and rapid repeated connect clicks
 *  - Keyboard focus moving to the first provider on open
 *
 * No browser extension is required: the Stellar Wallets Kit, the lazy kit
 * loader, and useWallet are all mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ── Stellar Wallets Kit (never loaded for real) ──────────────────────────────
const KIT_PROVIDERS = vi.hoisted(() => ({
  FREIGHTER_ID: "freighter",
  XBULL_ID: "xbull",
  LOBSTR_ID: "lobstr",
  ALBEDO_ID: "albedo",
}));

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  ...KIT_PROVIDERS,
  WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET", FUTURENET: "FUTURENET" },
  StellarWalletsKit: vi.fn(),
  allowAllModules: vi.fn(() => []),
}));

// Dynamic `import()` of the kit (ssr: false path) is stubbed out.
vi.mock("@/lib/lazyModules", () => ({
  preloadWalletKit: vi.fn(),
}));

// ── Wallet hook ──────────────────────────────────────────────────────────────
const connectWallet = vi.fn();
const probeWalletProviderHealth = vi.fn();

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ connectWallet, isConnected: false }),
  probeWalletProviderHealth: (id: string) => probeWalletProviderHealth(id),
}));

const breakpoint = { isMobile: false };
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: () => breakpoint,
}));

// ── Stores: real uiStore so the modal is driven by the actual trigger ────────
vi.mock("@/store", async () => await vi.importActual("@/store/uiStore"));

const enterWatchMode = vi.fn();
vi.mock("@/store/walletStore", () => ({
  useWalletStore: { getState: () => ({ enterWatchMode }) },
}));

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ENABLE_DEVTOOLS: false },
}));

// ── UI deps ──────────────────────────────────────────────────────────────────
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

vi.mock("framer-motion", () => {
  const strip = ({
    children: _c,
    initial: _i,
    animate: _a,
    exit: _e,
    transition: _t,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => props as Record<string, unknown>;
  return {
    motion: {
      div: (p: React.PropsWithChildren<Record<string, unknown>>) => <div {...strip(p)}>{p.children}</div>,
      p: (p: React.PropsWithChildren<Record<string, unknown>>) => <p {...strip(p)}>{p.children}</p>,
    },
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

import { WalletConnectModal } from "../WalletConnectModal";
import { useUIStore } from "@/store/uiStore";
import { preloadWalletKit } from "@/lib/lazyModules";

type ExtensionWindow = Window & { freighter?: unknown; xBullSDK?: unknown; lobstr?: unknown };

const PROVIDER_ACTION = /^(Connect|Install|Open) /;

function healthFor(id: string) {
  const installed =
    id === "albedo" ||
    (id === "freighter" && !!(window as ExtensionWindow).freighter) ||
    (id === "xbull" && !!(window as ExtensionWindow).xBullSDK) ||
    (id === "lobstr" && !!(window as ExtensionWindow).lobstr);
  return {
    id,
    installed,
    state: installed ? "ready" : "missing",
    message: installed ? "Ready" : "Extension not detected",
  } as const;
}

function openModal() {
  act(() => useUIStore.getState().setWalletModalOpen(true));
}

function renderModal({ open = true } = {}) {
  const utils = render(<WalletConnectModal />);
  if (open) openModal();
  return utils;
}

async function getDialog() {
  return screen.findByRole("dialog");
}

/** aria-labels of the per-provider action controls, in DOM order. */
function providerActionLabels(dialog: HTMLElement): string[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .filter((label) => PROVIDER_ACTION.test(label));
}

beforeEach(() => {
  act(() => useUIStore.setState({ walletModalOpen: false }));
  breakpoint.isMobile = false;
  connectWallet.mockReset();
  probeWalletProviderHealth.mockReset();
  probeWalletProviderHealth.mockImplementation(async (id: string) => healthFor(id));
});

afterEach(() => {
  delete (window as ExtensionWindow).freighter;
  delete (window as ExtensionWindow).xBullSDK;
  delete (window as ExtensionWindow).lobstr;
});

describe("WalletConnectModal", () => {
  describe("opening from the uiStore trigger", () => {
    it("renders nothing while walletModalOpen is false", () => {
      renderModal({ open: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens when setWalletModalOpen(true) is called and has an accessible name", async () => {
      renderModal({ open: false });
      openModal();

      const dialog = await getDialog();
      expect(dialog).toHaveAccessibleName("connectTitle");
      expect(dialog).toHaveAccessibleDescription("connectToAccess");
    });

    it("preloads the wallet kit and probes every provider on open", async () => {
      renderModal();
      await getDialog();

      expect(preloadWalletKit).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(probeWalletProviderHealth).toHaveBeenCalledTimes(4));
      expect(probeWalletProviderHealth.mock.calls.map(([id]) => id)).toEqual([
        KIT_PROVIDERS.FREIGHTER_ID,
        KIT_PROVIDERS.XBULL_ID,
        KIT_PROVIDERS.LOBSTR_ID,
        KIT_PROVIDERS.ALBEDO_ID,
      ]);
    });

    it("closes on Escape and syncs the store", async () => {
      const user = userEvent.setup();
      renderModal();
      await getDialog();

      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(useUIStore.getState().walletModalOpen).toBe(false);
    });
  });

  describe("provider list", () => {
    it("renders providers in a stable order", async () => {
      renderModal();
      const dialog = await getDialog();

      expect(providerActionLabels(dialog)).toMatchInlineSnapshot(`
        [
          "Install Freighter extension",
          "Install xBull Wallet extension",
          "Install LOBSTR extension",
          "Connect Albedo",
        ]
      `);
    });

    it("labels provider buttons with the wallet name when extensions are installed", async () => {
      (window as ExtensionWindow).freighter = {};
      (window as ExtensionWindow).xBullSDK = {};
      (window as ExtensionWindow).lobstr = {};
      renderModal();
      const dialog = await getDialog();

      for (const name of ["Freighter", "xBull Wallet", "LOBSTR", "Albedo"]) {
        expect(
          within(dialog).getByRole("button", { name: `Connect ${name}` }),
        ).toBeInTheDocument();
      }
      expect(providerActionLabels(dialog)).toEqual([
        "Connect Freighter",
        "Connect xBull Wallet",
        "Connect LOBSTR",
        "Connect Albedo",
      ]);
    });

    it("marks Freighter as popular", async () => {
      renderModal();
      const dialog = await getDialog();
      expect(within(dialog).getAllByText("popular")).toHaveLength(1);
    });
  });

  describe("unavailable extensions", () => {
    it("shows not-installed badges and install links without an extension", async () => {
      renderModal();
      const dialog = await getDialog();

      // Freighter, xBull and LOBSTR need an extension; Albedo is web-based.
      expect(within(dialog).getAllByText("notInstalled")).toHaveLength(3);

      const install = within(dialog).getByRole("link", { name: "Install Freighter extension" });
      expect(install).toHaveAttribute("target", "_blank");
      expect(install).toHaveAttribute("rel", "noopener noreferrer");
      expect(
        within(dialog).queryByRole("button", { name: "Connect Freighter" }),
      ).not.toBeInTheDocument();
    });

    it("renders health probe messages for each provider", async () => {
      renderModal();
      const dialog = await getDialog();

      await waitFor(() =>
        expect(within(dialog).getAllByText("Extension not detected").length).toBeGreaterThan(0),
      );
      expect(within(dialog).getAllByText("Ready").length).toBeGreaterThan(0);
    });

    it("disables Connect when the health probe reports an unsupported network", async () => {
      probeWalletProviderHealth.mockImplementation(async (id: string) =>
        id === "albedo"
          ? { id, installed: true, state: "unsupported_network", message: "Wrong network" }
          : healthFor(id),
      );
      renderModal();
      const dialog = await getDialog();

      const albedo = within(dialog).getByRole("button", { name: "Connect Albedo" });
      await waitFor(() => expect(albedo).toBeDisabled());
    });

    it("offers a mobile deep link instead of an install link on mobile", async () => {
      breakpoint.isMobile = true;
      renderModal();
      const dialog = await getDialog();

      expect(
        within(dialog).getByRole("button", { name: "Open Freighter mobile app" }),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText("notInstalled")).not.toBeInTheDocument();
    });
  });

  describe("connection errors and retry", () => {
    it("shows the error message and a retry button when connect fails", async () => {
      const user = userEvent.setup();
      connectWallet.mockRejectedValueOnce(new Error("User declined access"));
      renderModal();
      const dialog = await getDialog();

      await user.click(within(dialog).getByRole("button", { name: "Connect Albedo" }));

      expect(await within(dialog).findByText("User declined access")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /retry/ })).toBeInTheDocument();
      expect(connectWallet).toHaveBeenCalledWith(KIT_PROVIDERS.ALBEDO_ID);
    });

    it("falls back to a generic message for non-Error rejections", async () => {
      const user = userEvent.setup();
      connectWallet.mockRejectedValueOnce("timeout");
      renderModal();
      const dialog = await getDialog();

      await user.click(within(dialog).getByRole("button", { name: "Connect Albedo" }));

      expect(
        await within(dialog).findByText("Connection failed. Please try again."),
      ).toBeInTheDocument();
    });

    it("retries the same provider and shows success", async () => {
      const user = userEvent.setup();
      connectWallet
        .mockRejectedValueOnce(new Error("Network request failed"))
        .mockResolvedValueOnce(undefined);
      renderModal();
      const dialog = await getDialog();

      await user.click(within(dialog).getByRole("button", { name: "Connect Albedo" }));
      await user.click(await within(dialog).findByRole("button", { name: /retry/ }));

      expect(await within(dialog).findByText("walletConnected")).toBeInTheDocument();
      expect(connectWallet).toHaveBeenCalledTimes(2);
      expect(connectWallet).toHaveBeenNthCalledWith(2, KIT_PROVIDERS.ALBEDO_ID);

      await waitFor(() => expect(useUIStore.getState().walletModalOpen).toBe(false), {
        timeout: 3000,
      });
    });

    it("ignores rapid repeated connect clicks while a connection is pending", async () => {
      (window as ExtensionWindow).freighter = {};
      connectWallet.mockImplementation(() => new Promise(() => {}));
      renderModal();
      const dialog = await getDialog();

      const freighter = within(dialog).getByRole("button", { name: "Connect Freighter" });
      fireEvent.click(freighter);
      fireEvent.click(freighter);
      fireEvent.click(freighter);

      expect(connectWallet).toHaveBeenCalledTimes(1);
      expect(dialog).toHaveAttribute("aria-busy", "true");
      // Other providers are locked until the pending connection settles.
      expect(within(dialog).getByRole("button", { name: "Connect Albedo" })).toBeDisabled();
    });
  });

  describe("keyboard focus", () => {
    it("moves focus to the first provider's Connect button on open", async () => {
      (window as ExtensionWindow).freighter = {};
      renderModal();
      const dialog = await getDialog();

      const first = within(dialog).getByRole("button", { name: "Connect Freighter" });
      await waitFor(() => expect(first).toHaveFocus());
    });

    it("keeps focus inside the dialog when the first provider is not installed", async () => {
      renderModal();
      const dialog = await getDialog();

      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    });
  });
});
