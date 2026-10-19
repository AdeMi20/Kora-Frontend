/**
 * Navbar mobile menu — focus trap, focus return (Issue #1009) and dismiss
 * behaviour (Issue #1010).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

let mockPathname = "/marketplace";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        rest.onClick?.(e);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Strip animation props and forward refs so the focus-trap ref reaches the DOM.
// Components are cached per tag so re-renders do not remount the menu.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const cache = new Map<string, React.ElementType>();
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!cache.has(tag)) {
          const Component = React.forwardRef<HTMLElement, Record<string, unknown>>(
            ({ initial, animate, exit, transition, layoutId, ...rest }, ref) =>
              React.createElement(tag, { ...rest, ref }),
          );
          Component.displayName = `motion.${tag}`;
          cache.set(tag, Component);
        }
        return cache.get(tag);
      },
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/components/wallet/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));
vi.mock("@/components/wallet/WalletBalance", () => ({
  WalletBalance: () => null,
}));
vi.mock("@/components/layout/NetworkStatusIndicator", () => ({
  NetworkStatusIndicator: () => null,
}));
vi.mock("@/components/layout/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("@/hooks/useChangelogBadge", () => ({
  useChangelogBadge: () => ({ hasUnread: false }),
}));
vi.mock("@/lib/featureFlags", () => ({
  useFeatureFlag: () => false,
}));
vi.mock("@/store/walletStore", () => ({
  useWalletStore: (selector: (s: { isConnected: boolean; address: string | null }) => unknown) =>
    selector({ isConnected: false, address: null }),
}));

import { Navbar } from "../Navbar";
import { useUIStore } from "@/store/uiStore";

const MENU_ID = "mobile-nav-menu";

function getMenuButton() {
  return document.querySelector<HTMLButtonElement>(`button[aria-controls="${MENU_ID}"]`)!;
}

function getMenu() {
  return document.getElementById(MENU_ID);
}

function openMenu() {
  fireEvent.click(getMenuButton());
  const menu = getMenu();
  expect(menu).not.toBeNull();
  return menu!;
}

function focusableIn(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
}

describe("Navbar mobile menu", () => {
  let originalGetClientRects: () => DOMRectList;

  beforeEach(() => {
    mockPathname = "/marketplace";
    document.body.style.overflow = "";
    act(() => {
      useUIStore.setState({ walletModalOpen: false, commandPaletteOpen: false });
    });
    // jsdom has no layout; report a box so useFocusTrap treats controls as visible.
    originalGetClientRects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = function () {
      return [{ width: 100, height: 20 }] as unknown as DOMRectList;
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getClientRects = originalGetClientRects;
  });

  describe("ARIA wiring (#1009)", () => {
    it("links the toggle to the menu with aria-controls and aria-expanded", () => {
      render(<Navbar />);
      const button = getMenuButton();
      expect(button).toHaveAttribute("aria-controls", MENU_ID);
      expect(button).toHaveAttribute("aria-expanded", "false");

      openMenu();
      expect(button).toHaveAttribute("aria-expanded", "true");
    });

    it("renders the open menu as a modal dialog", () => {
      render(<Navbar />);
      const menu = openMenu();
      expect(menu).toHaveAttribute("role", "dialog");
      expect(menu).toHaveAttribute("aria-modal", "true");
      expect(menu).toHaveAttribute("aria-label");
    });

    it("leaves the desktop nav untouched", () => {
      render(<Navbar />);
      expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
      expect(getMenu()).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("focus trap (#1009)", () => {
    it("moves focus into the menu on open", () => {
      render(<Navbar />);
      const menu = openMenu();
      expect(menu.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(focusableIn(menu)[0]);
    });

    it("wraps Tab from the last control back to the first", () => {
      render(<Navbar />);
      const menu = openMenu();
      const items = focusableIn(menu);
      const last = items[items.length - 1];

      last.focus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(items[0]);
    });

    it("wraps Shift+Tab from the first control to the last", () => {
      render(<Navbar />);
      const menu = openMenu();
      const items = focusableIn(menu);

      items[0].focus();
      fireEvent.keyDown(items[0], { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(items[items.length - 1]);
    });

    it("pulls focus back in when it has escaped the menu", () => {
      render(<Navbar />);
      const menu = openMenu();
      const outside = screen.getByRole("button", { name: "Open command palette" });

      outside.focus();
      fireEvent.keyDown(outside, { key: "Tab" });
      expect(menu.contains(document.activeElement)).toBe(true);
    });

    it("closes on Escape and returns focus to the menu button", () => {
      render(<Navbar />);
      const menu = openMenu();
      fireEvent.keyDown(focusableIn(menu)[0], { key: "Escape" });

      expect(getMenu()).toBeNull();
      expect(document.activeElement).toBe(getMenuButton());
    });

    it("returns focus to the menu button when closed via the toggle", () => {
      render(<Navbar />);
      openMenu();
      fireEvent.click(getMenuButton());

      expect(getMenu()).toBeNull();
      expect(document.activeElement).toBe(getMenuButton());
    });

    it("pauses the trap while the wallet modal is open", () => {
      render(<Navbar />);
      openMenu();
      act(() => {
        useUIStore.setState({ walletModalOpen: true });
      });

      // Escape belongs to the nested dialog; the menu stays open beneath it.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(getMenu()).not.toBeNull();
    });
  });

  describe("dismiss behaviour (#1010)", () => {
    it("closes when the pathname changes", () => {
      const { rerender } = render(<Navbar />);
      openMenu();

      mockPathname = "/dashboard/investor";
      rerender(<Navbar />);
      expect(getMenu()).toBeNull();
    });

    it("closes when a menu link is activated, even for same-path navigation", () => {
      render(<Navbar />);
      const menu = openMenu();
      const link = menu.querySelector<HTMLAnchorElement>('a[href="/marketplace"]')!;

      fireEvent.click(link);
      expect(getMenu()).toBeNull();
    });

    it("closes on mousedown outside the header", () => {
      render(<Navbar />);
      openMenu();
      const outside = document.createElement("div");
      document.body.appendChild(outside);

      fireEvent.mouseDown(outside);
      expect(getMenu()).toBeNull();
      outside.remove();
    });

    it("closes on touchstart outside the header", () => {
      render(<Navbar />);
      openMenu();
      const outside = document.createElement("div");
      document.body.appendChild(outside);

      fireEvent.touchStart(outside);
      expect(getMenu()).toBeNull();
      outside.remove();
    });

    it("stays open on mousedown inside the menu", () => {
      render(<Navbar />);
      const menu = openMenu();

      fireEvent.mouseDown(focusableIn(menu)[0]);
      expect(getMenu()).not.toBeNull();
    });

    it("closes when the backdrop overlay is clicked", () => {
      render(<Navbar />);
      openMenu();
      const overlay = screen.getByTestId("mobile-nav-overlay");

      fireEvent.mouseDown(overlay);
      fireEvent.click(overlay);
      expect(getMenu()).toBeNull();
    });

    it("ignores clicks inside a portaled dialog", () => {
      render(<Navbar />);
      openMenu();
      const portal = document.createElement("div");
      portal.setAttribute("role", "dialog");
      const inner = document.createElement("button");
      portal.appendChild(inner);
      document.body.appendChild(portal);

      fireEvent.mouseDown(inner);
      expect(getMenu()).not.toBeNull();
      portal.remove();
    });

    it("ignores outside clicks while the wallet modal is open", () => {
      render(<Navbar />);
      openMenu();
      act(() => {
        useUIStore.setState({ walletModalOpen: true });
      });
      const overlay = document.createElement("div");
      document.body.appendChild(overlay);

      fireEvent.mouseDown(overlay);
      expect(getMenu()).not.toBeNull();
      overlay.remove();
    });

    it("locks body scroll while open and releases it on close", () => {
      render(<Navbar />);
      openMenu();
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(document.body.style.overflow).toBe("");
    });

    it("releases the scroll lock when the menu closes on route change", () => {
      const { rerender } = render(<Navbar />);
      openMenu();
      expect(document.body.style.overflow).toBe("hidden");

      mockPathname = "/transactions";
      rerender(<Navbar />);
      expect(document.body.style.overflow).toBe("");
    });
  });
});
