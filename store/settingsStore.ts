/**
 * settingsStore — persists user notification preferences via Zustand persist middleware.
 * Consistent with walletStore pattern. All notifications default to true on first load.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from "./storageAdapter";

import {
  DEFAULT_CONCENTRATION_THRESHOLDS,
  SNOOZE_DURATIONS_MS,
  type ConcentrationThresholds,
  type SnoozeEntry,
} from "@/lib/concentrationRisk";

export type MaturityReminderDays = 1 | 3 | 7;
export type Persona = "investor" | "sme";

export interface NotificationPrefs {
  maturityReminder: boolean;
  fundingAlerts: boolean;
  repaymentAlerts: boolean;
  maturityReminderDays: MaturityReminderDays;
}

export interface TourSettings {
  persona: Persona;
  stepIndex: number;
  completed: boolean;
  skipped: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  maturityReminder: true,
  fundingAlerts: true,
  repaymentAlerts: true,
  maturityReminderDays: 3,
};

export const DEFAULT_TOUR_SETTINGS: TourSettings = {
  persona: "investor",
  stepIndex: 0,
  completed: false,
  skipped: false,
};

const TOUR_STORAGE_KEY = "kora-tour-done";

/**
 * Concentration alert state (issue #604).
 *
 * Dismissals and snoozes are keyed by `dimension:bucket`, not by percentage, so
 * a dismissal survives the number moving. Otherwise every recomputation would
 * resurrect an alert the investor had already acknowledged.
 */
export interface ConcentrationSettings {
  thresholds: ConcentrationThresholds;
  dismissedKeys: string[];
  snoozes: SnoozeEntry[];
}

export const DEFAULT_CONCENTRATION_SETTINGS: ConcentrationSettings = {
  thresholds: DEFAULT_CONCENTRATION_THRESHOLDS,
  dismissedKeys: [],
  snoozes: [],
};

interface SettingsStore {
  notifications: NotificationPrefs;
  setNotifications: (prefs: Partial<NotificationPrefs>) => void;
  resetNotifications: () => void;
  tour: TourSettings;
  setTourSettings: (settings: Partial<TourSettings>) => void;
  resetTourSettings: () => void;
  restartTour: (persona?: Persona) => void;
  concentration: ConcentrationSettings;
  setConcentrationThresholds: (thresholds: Partial<ConcentrationThresholds>) => void;
  dismissConcentrationAlert: (key: string) => void;
  snoozeConcentrationAlert: (key: string, durationMs?: number) => void;
  resetConcentrationAlerts: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      notifications: DEFAULT_NOTIFICATION_PREFS,
      setNotifications: (prefs) =>
        set((s) => ({ notifications: { ...s.notifications, ...prefs } })),
      resetNotifications: () => set({ notifications: DEFAULT_NOTIFICATION_PREFS }),
      tour: DEFAULT_TOUR_SETTINGS,
      setTourSettings: (settings) =>
        set((s) => {
          const nextTour = { ...s.tour, ...settings };
          if (typeof window !== "undefined") {
            if (nextTour.completed || nextTour.skipped) {
              try {
                localStorage.setItem(TOUR_STORAGE_KEY, "true");
              } catch {
                // storage unavailable
              }
            }
          }
          return { tour: nextTour };
        }),
      resetTourSettings: () => {
        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem(TOUR_STORAGE_KEY);
          } catch {
            // storage unavailable
          }
        }
        set({ tour: DEFAULT_TOUR_SETTINGS });
      },
      concentration: DEFAULT_CONCENTRATION_SETTINGS,
      setConcentrationThresholds: (thresholds) =>
        set((s) => ({
          concentration: {
            ...s.concentration,
            thresholds: { ...s.concentration.thresholds, ...thresholds },
          },
        })),
      dismissConcentrationAlert: (key) =>
        set((s) => ({
          concentration: {
            ...s.concentration,
            dismissedKeys: s.concentration.dismissedKeys.includes(key)
              ? s.concentration.dismissedKeys
              : [...s.concentration.dismissedKeys, key],
          },
        })),
      snoozeConcentrationAlert: (key, durationMs = SNOOZE_DURATIONS_MS.day) =>
        set((s) => ({
          concentration: {
            ...s.concentration,
            // Replace any existing snooze for this key rather than stacking, so
            // snoozing twice does not silently double the delay.
            snoozes: [
              ...s.concentration.snoozes.filter((entry) => entry.key !== key),
              { key, until: Date.now() + durationMs },
            ],
          },
        })),
      resetConcentrationAlerts: () =>
        set((s) => ({
          concentration: { ...s.concentration, dismissedKeys: [], snoozes: [] },
        })),
      restartTour: (persona) => {
        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem(TOUR_STORAGE_KEY);
          } catch {
            // storage unavailable
          }
        }
        set((s) => ({
          tour: {
            persona: persona ?? s.tour.persona,
            stepIndex: 0,
            completed: false,
            skipped: false,
          },
        }));
      },
    }),
    {
      name: "kora-settings-store",
      // Writes go through the safe helpers so a full or blocked storage (e.g.
      // QuotaExceededError on dismiss) keeps the in-memory change instead of
      // throwing out of the click handler (#943).
      storage: createJSONStorage(() => ({
        getItem: safeStorageGetItem,
        setItem: safeStorageSetItem,
        removeItem: safeStorageRemoveItem,
      })),
    }
  )
);

