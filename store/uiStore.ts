import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TxState } from "@/types";
import { useSettingsStore } from "./settingsStore";

export type Theme = "light" | "dark" | "system";

export type MaturityReminderDays = 1 | 3 | 7;

export interface NotificationPreferences {
  txConfirmed: boolean;
  invoiceFunded: boolean;
  maturityReminder: boolean;
  yieldAvailable: boolean;
  maturityReminderDays: MaturityReminderDays;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  txConfirmed: true,
  invoiceFunded: true,
  maturityReminder: true,
  yieldAvailable: true,
  maturityReminderDays: 3,
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
export const DEFAULT_SHORTCUTS_ENABLED = true;

interface UIStore {
  walletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  changelogOpen: boolean;
  setChangelogOpen: (open: boolean) => void;

  // intended destination when wallet connect is required
  intendedDestination: string | null;
  setIntendedDestination: (dest: string | null) => void;

  txState: TxState;
  setTxState: (state: TxState) => void;
  resetTxState: () => void;

  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  /**
   * @deprecated Notification preferences are owned by `settingsStore`. This
   * mirror is kept only so the barrel export and legacy call sites keep
   * resolving; the setter below forwards to the canonical store. Read
   * `useSettingsStore((s) => s.notifications)` for gating decisions.
   */
  notificationPreferences: NotificationPreferences;
  /** @deprecated Writes through to the canonical `settingsStore`. */
  setNotificationPreferences: (prefs: Partial<NotificationPreferences>) => void;
  /** @deprecated Resets the canonical `settingsStore`. */
  resetNotificationPreferences: () => void;

  // Keyboard shortcuts
  shortcutsEnabled: boolean;
  setShortcutsEnabled: (enabled: boolean) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      walletModalOpen: false,
      setWalletModalOpen: (walletModalOpen) => set({ walletModalOpen }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      changelogOpen: false,
      setChangelogOpen: (changelogOpen) => set({ changelogOpen }),

      intendedDestination: null,
      setIntendedDestination: (intendedDestination) => set({ intendedDestination }),

      txState: { status: "idle" },
      setTxState: (txState) => set({ txState }),
      resetTxState: () => set({ txState: { status: "idle" } }),

      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      // "system" = respect prefers-color-scheme (first-visit default, never
      // cycled back to once the user explicitly picks a preference).
      theme: "system",
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => {
        // Resolve "system" to the OS preference so we can flip it correctly,
        // then toggle between "dark" and "light" only — system is the implicit
        // default on first visit and we don't want to cycle through it again.
        const current = get().theme;
        const resolved =
          current === "system"
            ? typeof window !== "undefined" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : current;
        set({ theme: resolved === "dark" ? "light" : "dark" });
      },

      notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
      // Deprecated shim: keep the local mirror in sync for any stale reader,
      // but the canonical write is what every notification gate now reads, so
      // `/settings` toggles can no longer disagree with the wallet dropdown.
      setNotificationPreferences: (prefs) => {
        useSettingsStore.getState().setNotifications(prefs);
        set((s) => ({
          notificationPreferences: {
            ...s.notificationPreferences,
            ...prefs,
          },
        }));
      },
      resetNotificationPreferences: () => {
        useSettingsStore.getState().resetNotifications();
        set({ notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES });
      },

      // Keyboard shortcuts
      shortcutsEnabled: DEFAULT_SHORTCUTS_ENABLED,
      setShortcutsEnabled: (shortcutsEnabled) => set({ shortcutsEnabled }),
    }),
    {
      name: "kora-ui-store",
      // Notification preferences are intentionally omitted: they are persisted
      // once, in `settingsStore`, and duplicating them here is what let the two
      // copies drift apart. `settingsStore` migrates any legacy payload.
      partialize: (state) => ({
        theme: state.theme,
        shortcutsEnabled: state.shortcutsEnabled,
      }),
    }
  )
);
