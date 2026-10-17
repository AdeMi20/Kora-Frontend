/**
 * Unit tests for uiStore (issue #763).
 *
 * Covers:
 *  - walletModalOpen state and setter
 *  - commandPaletteOpen state and setter
 *  - changelogOpen state and setter
 *  - intendedDestination state and setter
 *  - txState state and setter/reset
 *  - sidebarOpen state and setter
 *  - theme state, setter, and toggleTheme
 *  - notificationPreferences state, setter, and reset
 *  - shortcutsEnabled state and setter
 *  - persist middleware partializes correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useUIStore, DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_SHORTCUTS_ENABLED } from "@/store/uiStore";
import { useSettingsStore, DEFAULT_NOTIFICATION_PREFS } from "@/store/settingsStore";

describe("uiStore", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useUIStore.setState({
      walletModalOpen: false,
      commandPaletteOpen: false,
      changelogOpen: false,
      intendedDestination: null,
      txState: { status: "idle" },
      sidebarOpen: false,
      theme: "system",
      notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
      shortcutsEnabled: DEFAULT_SHORTCUTS_ENABLED,
    });
    // The canonical notification store is the write-through target of the
    // deprecated setters; reset it too so forwarding assertions are isolated.
    useSettingsStore.setState({ notifications: { ...DEFAULT_NOTIFICATION_PREFS } });
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe("walletModalOpen", () => {
    it("defaults to false", () => {
      expect(useUIStore.getState().walletModalOpen).toBe(false);
    });

    it("setWalletModalOpen updates state", () => {
      useUIStore.getState().setWalletModalOpen(true);
      expect(useUIStore.getState().walletModalOpen).toBe(true);

      useUIStore.getState().setWalletModalOpen(false);
      expect(useUIStore.getState().walletModalOpen).toBe(false);
    });
  });

  describe("commandPaletteOpen", () => {
    it("defaults to false", () => {
      expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    });

    it("setCommandPaletteOpen updates state", () => {
      useUIStore.getState().setCommandPaletteOpen(true);
      expect(useUIStore.getState().commandPaletteOpen).toBe(true);

      useUIStore.getState().setCommandPaletteOpen(false);
      expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  describe("changelogOpen", () => {
    it("defaults to false", () => {
      expect(useUIStore.getState().changelogOpen).toBe(false);
    });

    it("setChangelogOpen updates state", () => {
      useUIStore.getState().setChangelogOpen(true);
      expect(useUIStore.getState().changelogOpen).toBe(true);

      useUIStore.getState().setChangelogOpen(false);
      expect(useUIStore.getState().changelogOpen).toBe(false);
    });
  });

  describe("intendedDestination", () => {
    it("defaults to null", () => {
      expect(useUIStore.getState().intendedDestination).toBeNull();
    });

    it("setIntendedDestination updates state", () => {
      useUIStore.getState().setIntendedDestination("/dashboard");
      expect(useUIStore.getState().intendedDestination).toBe("/dashboard");

      useUIStore.getState().setIntendedDestination(null);
      expect(useUIStore.getState().intendedDestination).toBeNull();
    });
  });

  describe("txState", () => {
    it("defaults to idle status", () => {
      expect(useUIStore.getState().txState).toEqual({ status: "idle" });
    });

    it("setTxState updates state", () => {
      const newState = { status: "pending" as const, hash: "0x123" };
      useUIStore.getState().setTxState(newState);
      expect(useUIStore.getState().txState).toEqual(newState);
    });

    it("resetTxState resets to idle", () => {
      useUIStore.getState().setTxState({ status: "pending" as const, hash: "0x123" });
      useUIStore.getState().resetTxState();
      expect(useUIStore.getState().txState).toEqual({ status: "idle" });
    });
  });

  describe("sidebarOpen", () => {
    it("defaults to false", () => {
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });

    it("setSidebarOpen updates state", () => {
      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);

      useUIStore.getState().setSidebarOpen(false);
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe("theme", () => {
    it("defaults to 'system'", () => {
      expect(useUIStore.getState().theme).toBe("system");
    });

    it("setTheme updates theme", () => {
      useUIStore.getState().setTheme("dark");
      expect(useUIStore.getState().theme).toBe("dark");

      useUIStore.getState().setTheme("light");
      expect(useUIStore.getState().theme).toBe("light");

      useUIStore.getState().setTheme("system");
      expect(useUIStore.getState().theme).toBe("system");
    });

    it("toggleTheme toggles between dark and light", () => {
      // Start with system - need to mock matchMedia
      const matchMediaMock = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      Object.defineProperty(window, "matchMedia", { value: matchMediaMock, writable: true });

      useUIStore.setState({ theme: "system" });
      useUIStore.getState().toggleTheme();
      // system with prefers-color-scheme: light -> resolves to "light", then toggles to "dark"
      expect(useUIStore.getState().theme).toBe("dark");

      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe("light");

      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe("dark");
    });

    it("toggleTheme respects dark preference when system", () => {
      const matchMediaMock = vi.fn().mockImplementation((query) => ({
        matches: true, // prefers dark
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      Object.defineProperty(window, "matchMedia", { value: matchMediaMock, writable: true });

      useUIStore.setState({ theme: "system" });
      useUIStore.getState().toggleTheme();
      // system with prefers-color-scheme: dark -> resolves to "dark", then toggles to "light"
      expect(useUIStore.getState().theme).toBe("light");

      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe("dark");
    });

    it("toggleTheme does not cycle back to system", () => {
      useUIStore.setState({ theme: "light" });
      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe("dark");

      useUIStore.getState().toggleTheme();
      expect(useUIStore.getState().theme).toBe("light");
      // Never goes back to "system"
    });
  });

  describe("notificationPreferences (deprecated mirror)", () => {
    it("defaults to DEFAULT_NOTIFICATION_PREFERENCES", () => {
      expect(useUIStore.getState().notificationPreferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it("setNotificationPreferences merges partial preferences", () => {
      useUIStore.getState().setNotificationPreferences({ txConfirmed: false });
      const prefs = useUIStore.getState().notificationPreferences;
      expect(prefs.txConfirmed).toBe(false);
      expect(prefs.invoiceFunded).toBe(true); // unchanged
      expect(prefs.maturityReminder).toBe(true); // unchanged
      expect(prefs.yieldAvailable).toBe(true); // unchanged
      expect(prefs.maturityReminderDays).toBe(3); // unchanged
    });

    it("forwards writes to the canonical settingsStore", () => {
      useUIStore.getState().setNotificationPreferences({ txConfirmed: false });

      // The canonical store is what every notification gate reads, so the
      // legacy setter must keep it in sync rather than only mutating the
      // deprecated mirror.
      expect(useSettingsStore.getState().notifications.txConfirmed).toBe(false);
    });

    it("setNotificationPreferences updates multiple preferences", () => {
      useUIStore.getState().setNotificationPreferences({
        txConfirmed: false,
        maturityReminderDays: 7,
      });
      const prefs = useUIStore.getState().notificationPreferences;
      expect(prefs.txConfirmed).toBe(false);
      expect(prefs.maturityReminderDays).toBe(7);
    });

    it("resetNotificationPreferences restores defaults", () => {
      useUIStore.getState().setNotificationPreferences({
        txConfirmed: false,
        invoiceFunded: false,
        maturityReminder: false,
        yieldAvailable: false,
        maturityReminderDays: 1,
      });
      useUIStore.getState().resetNotificationPreferences();
      expect(useUIStore.getState().notificationPreferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it("resetNotificationPreferences resets the canonical store too", () => {
      useUIStore.getState().setNotificationPreferences({ txConfirmed: false });
      useUIStore.getState().resetNotificationPreferences();

      expect(useSettingsStore.getState().notifications).toEqual(DEFAULT_NOTIFICATION_PREFS);
    });

    it("validates maturityReminderDays values", () => {
      // TypeScript enforces this at compile time, but we test runtime behavior
      useUIStore.getState().setNotificationPreferences({ maturityReminderDays: 1 });
      expect(useUIStore.getState().notificationPreferences.maturityReminderDays).toBe(1);

      useUIStore.getState().setNotificationPreferences({ maturityReminderDays: 7 });
      expect(useUIStore.getState().notificationPreferences.maturityReminderDays).toBe(7);
    });
  });

  describe("shortcutsEnabled", () => {
    it("defaults to true", () => {
      expect(useUIStore.getState().shortcutsEnabled).toBe(DEFAULT_SHORTCUTS_ENABLED);
    });

    it("setShortcutsEnabled updates state", () => {
      useUIStore.getState().setShortcutsEnabled(false);
      expect(useUIStore.getState().shortcutsEnabled).toBe(false);

      useUIStore.getState().setShortcutsEnabled(true);
      expect(useUIStore.getState().shortcutsEnabled).toBe(true);
    });
  });

  describe("persist middleware", () => {
    it("partializes state to only persist theme and shortcutsEnabled", () => {
      // The persist config uses partialize to only save these fields;
      // notificationPreferences are canonical in settingsStore, not duplicated
      // here (duplication is what let the two copies drift).
      const { partialize } = useUIStore.persist.getOptions();

      const partialized = partialize({
        walletModalOpen: true,
        commandPaletteOpen: true,
        changelogOpen: true,
        intendedDestination: "/test",
        txState: { status: "pending" as const },
        sidebarOpen: true,
        theme: "dark",
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, txConfirmed: false },
        shortcutsEnabled: false,
      });

      expect(partialized).toEqual({
        theme: "dark",
        shortcutsEnabled: false,
      });
    });

    it("persists theme to localStorage", () => {
      useUIStore.getState().setTheme("dark");

      // Check localStorage was updated
      const stored = localStorage.getItem("kora-ui-store");
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.theme).toBe("dark");
    });

    it("does not persist notificationPreferences to localStorage", () => {
      useUIStore.getState().setNotificationPreferences({ txConfirmed: false });

      const stored = localStorage.getItem("kora-ui-store");
      const parsed = JSON.parse(stored!);
      // The canonical copy lives in `kora-settings-store`.
      expect(parsed.state.notificationPreferences).toBeUndefined();
    });

    it("persists shortcutsEnabled to localStorage", () => {
      useUIStore.getState().setShortcutsEnabled(false);

      const stored = localStorage.getItem("kora-ui-store");
      const parsed = JSON.parse(stored!);
      expect(parsed.state.shortcutsEnabled).toBe(false);
    });

    it("does not persist walletModalOpen to localStorage", () => {
      useUIStore.getState().setWalletModalOpen(true);

      const stored = localStorage.getItem("kora-ui-store");
      const parsed = JSON.parse(stored!);
      expect(parsed.state.walletModalOpen).toBeUndefined();
    });

    it("does not persist commandPaletteOpen to localStorage", () => {
      useUIStore.getState().setCommandPaletteOpen(true);

      const stored = localStorage.getItem("kora-ui-store");
      const parsed = JSON.parse(stored!);
      expect(parsed.state.commandPaletteOpen).toBeUndefined();
    });

    it("does not persist txState to localStorage", () => {
      useUIStore.getState().setTxState({ status: "pending" as const });

      const stored = localStorage.getItem("kora-ui-store");
      const parsed = JSON.parse(stored!);
      expect(parsed.state.txState).toBeUndefined();
    });
  });

  describe("state isolation", () => {
    it("multiple state updates don't interfere", () => {
      useUIStore.getState().setWalletModalOpen(true);
      useUIStore.getState().setSidebarOpen(true);
      useUIStore.getState().setTheme("dark");

      const state = useUIStore.getState();
      expect(state.walletModalOpen).toBe(true);
      expect(state.sidebarOpen).toBe(true);
      expect(state.theme).toBe("dark");
      // Other states should be defaults
      expect(state.commandPaletteOpen).toBe(false);
      expect(state.changelogOpen).toBe(false);
    });
  });
});