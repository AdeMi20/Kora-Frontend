"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Store,
  PlusCircle,
  BarChart3,
  Menu,
  X,
  Sun,
  Moon,
  History,
  Keyboard,
  Search,
  Tag,
  Sparkles,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

const AddressBook = dynamic(
  () => import("@/components/wallet/AddressBook").then((m) => m.AddressBook),
  { ssr: false }
);
const TransactionHistoryDrawer = dynamic(
  () => import("@/components/transactions").then((m) => m.TransactionHistoryDrawer),
  { ssr: false }
);

import { WalletButton } from "@/components/wallet/WalletButton";
import { WalletBalance } from "@/components/wallet/WalletBalance";
import { NetworkStatusIndicator } from "@/components/layout/NetworkStatusIndicator";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { useUIStore } from "@/store/uiStore";
import { useChangelogBadge } from "@/hooks/useChangelogBadge";
import { useWalletStore } from "@/store/walletStore";
import { ShortcutBadge } from "@/components/ui/ShortcutBadge";
import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/lib/featureFlags";

const MENU_ID = "mobile-nav-menu";

/**
 * Changelog entry point with an unread dot (Issue #679).
 *
 * Releases were only discoverable through the footer link once the auto-open
 * modal had been dismissed. The dot marks a release the user has not opened
 * yet and clears itself when the modal opens.
 */
function ChangelogNavButton() {
  const setChangelogOpen = useUIStore((s) => s.setChangelogOpen);
  const { hasUnread } = useChangelogBadge();

  return (
    <button
      type="button"
      onClick={() => setChangelogOpen(true)}
      className="relative hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
      aria-label={hasUnread ? "Open changelog (new release available)" : "Open changelog"}
      title="Changelog"
    >
      <Sparkles className="h-4 w-4" />
      {hasUnread && (
        <span
          data-testid="changelog-unread-dot"
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
          aria-hidden
        />
      )}
    </button>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tSettings = useTranslations("settings");
  const isSecondaryEnabled = useFeatureFlag("secondary-market");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Granular selectors — Navbar only subscribes to the slices it renders.
  // Balance display is delegated to <WalletBalance> which has its own selector,
  // so balance polling never causes the navbar body to re-render.
  const isConnected = useWalletStore((s) => s.isConnected);
  const address = useWalletStore((s) => s.address);

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const shortcutsEnabled = useUIStore((s) => s.shortcutsEnabled);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const navRef = useRef<HTMLElement>(null);
  const [addressBookOpen, setAddressBookOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedTheme = theme === "system"
    ? (mounted && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  // Nav links defined inside component so labels are translated
  const NAV_LINKS = [
    { href: "/marketplace", label: t("marketplace"), icon: Store, shortcut: "G M" },
    ...(isSecondaryEnabled
      ? [{ href: "/secondary", label: t("secondaryMarket"), icon: Tag, shortcut: "G S" }]
      : []),
    { href: "/dashboard/investor", label: t("invest"), icon: BarChart3, shortcut: "G D" },
    { href: "/dashboard/sme", label: t("myInvoices"), icon: LayoutDashboard, shortcut: null },
    { href: "/invoice/create", label: t("createInvoice"), icon: PlusCircle, shortcut: "G C" },
    { href: "/transactions", label: t("history"), icon: History, shortcut: "G T" },
    { href: "/settings", label: tSettings("navLabel"), icon: Settings, shortcut: null },
  ];

  // Close on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            K
          </div>
          <span className="text-base font-semibold text-foreground">Kora</span>
          <span className="hidden rounded bg-kora-muted px-1.5 py-0.5 text-[10px] font-medium text-primary sm:block">
            {t("testnet")}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV_LINKS.map(({ href, label, shortcut }) => {
            const active = pathname.startsWith(href);
            let tourAttr = "";
            if (href === "/marketplace") tourAttr = "data-tour='marketplace-link'";
            else if (href === "/dashboard/sme") tourAttr = "data-tour='dashboard-link'";
            else if (href === "/dashboard/investor") tourAttr = "data-tour='investor-dashboard'";
            else if (href === "/invoice/create") tourAttr = "data-tour='create-invoice-btn'";
            else if (href === "/analytics") tourAttr = "data-tour='analytics-link'";

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                data-tour={
                  href === "/marketplace"
                    ? "marketplace-link"
                    : href === "/dashboard/sme"
                      ? "dashboard-link"
                      : href === "/dashboard/investor"
                        ? "investor-dashboard"
                        : href === "/invoice/create"
                          ? "create-invoice-btn"
                          : href === "/analytics"
                            ? "analytics-link"
                            : undefined
                }
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg bg-muted"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <span className="relative">{label}</span>
                {shortcut && shortcutsEnabled && (
                  <ShortcutBadge keys={shortcut} className="relative" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          <NetworkStatusIndicator />

          {/* Command palette trigger */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Open command palette (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">Search…</span>
            <kbd className="hidden md:flex items-center gap-0.5 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-medium">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="flex sm:hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Open command palette"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Language switcher */}
          <LanguageSwitcher />

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={
              theme === "dark" ? t("switchToLight") : t("switchToDark")
            }
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Moon className="h-5 w-5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="View transaction history"
          >
            <History className="h-5 w-5" />
          </button>

          <ChangelogNavButton />

          {/* Keyboard shortcut hint — desktop only */}
          {shortcutsEnabled && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("kora:open-shortcut-modal"))}
              className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
              aria-label="Open keyboard shortcuts reference"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={() => setAddressBookOpen(true)}
            className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t("addressBook")}
          </button>

          {/* WalletBalance subscribes only to balance; isolated from navbar re-renders */}
          {isConnected && address && (
            <WalletBalance />
          )}

          <div data-tour="wallet-button">
            <WalletButton />
          </div>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={mobileOpen}
            aria-controls={MENU_ID}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id={MENU_ID}
            role="navigation"
            aria-label="Mobile navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-background md:hidden"
          >
            <div className="px-4 pb-4 pt-2 space-y-1">
              {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-tour={
                      href === "/marketplace"
                        ? "marketplace-link"
                        : href === "/dashboard/sme"
                          ? "dashboard-link"
                          : href === "/dashboard/investor"
                            ? "investor-dashboard"
                            : href === "/invoice/create"
                              ? "create-invoice-btn"
                              : href === "/analytics"
                                ? "analytics-link"
                                : undefined
                    }
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </Link>
                );
              })}

              <div className="pt-2 border-t border-border space-y-2" data-tour="wallet-button">
                <WalletButton />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {addressBookOpen && (
        <AddressBook onClose={() => setAddressBookOpen(false)} />
      )}
      <TransactionHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
    </header>
  );
}
