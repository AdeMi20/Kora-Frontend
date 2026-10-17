import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationSettings } from "@/components/settings/NotificationSettings";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_TOUR_SETTINGS,
  useSettingsStore,
} from "@/store/settingsStore";
import { useUIStore } from "@/store/uiStore";

/**
 * Notification preference UI (Issue #767).
 *
 * The store is exercised for real rather than mocked: the thing worth testing
 * is that a toggle writes the preference the rest of the app reads, and a
 * mocked store would assert only that a spy was called with an object.
 */

const { restartTour, exportWalletDiagnostics, importWalletDiagnostics } = vi.hoisted(() => ({
  restartTour: vi.fn(),
  exportWalletDiagnostics: vi.fn(() => ({ network: "testnet" })),
  importWalletDiagnostics: vi.fn(),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ address: null, exportWalletDiagnostics, importWalletDiagnostics }),
}));

// next-intl needs a provider; the copy under test is the English strings in
// the component itself, so the key is enough to identify the element.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function prefs() {
  return useSettingsStore.getState().notifications;
}

describe("NotificationSettings", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      notifications: { ...DEFAULT_NOTIFICATION_PREFS },
      tour: { ...DEFAULT_TOUR_SETTINGS },
      restartTour,
    });
    useUIStore.setState({ shortcutsEnabled: true });
    restartTour.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("preference toggles", () => {
    it("renders one switch per notification type, reflecting the stored value", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, fundingAlerts: false },
      });

      render(<NotificationSettings />);

      expect(screen.getByRole("switch", { name: "Toggle Maturity Reminders" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByRole("switch", { name: "Toggle Funding Alerts" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByRole("switch", { name: "Toggle Repayment Alerts" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it.each([
      ["Maturity Reminders", "maturityReminder"],
      ["Funding Alerts", "fundingAlerts"],
      ["Repayment Alerts", "repaymentAlerts"],
    ] as const)("writes %s to the store when switched off", (label, key) => {
      render(<NotificationSettings />);

      fireEvent.click(screen.getByRole("switch", { name: `Toggle ${label}` }));

      expect(prefs()[key]).toBe(false);
    });

    it("switches a preference back on", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, repaymentAlerts: false },
      });

      render(<NotificationSettings />);
      fireEvent.click(screen.getByRole("switch", { name: "Toggle Repayment Alerts" }));

      expect(prefs().repaymentAlerts).toBe(true);
    });

    it("leaves the other preferences untouched", () => {
      // The store merges partials; a regression to a whole-object write would
      // silently reset everything the user had configured.
      render(<NotificationSettings />);

      fireEvent.click(screen.getByRole("switch", { name: "Toggle Funding Alerts" }));

      expect(prefs()).toEqual({
        ...DEFAULT_NOTIFICATION_PREFS,
        fundingAlerts: false,
      });
    });
  });

  describe("reminder timing", () => {
    it("shows the stored lead time", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, maturityReminderDays: 7 },
      });

      render(<NotificationSettings />);

      expect(screen.getByLabelText("Reminder timing")).toHaveValue("7");
    });

    it("stores the lead time as a number, not the select's string", () => {
      render(<NotificationSettings />);

      fireEvent.change(screen.getByLabelText("Reminder timing"), { target: { value: "1" } });

      expect(prefs().maturityReminderDays).toBe(1);
    });

    it("is disabled while maturity reminders are off", () => {
      // Choosing when to be reminded is meaningless if the reminder is off.
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, maturityReminder: false },
      });

      render(<NotificationSettings />);

      expect(screen.getByLabelText("Reminder timing")).toBeDisabled();
    });

    it("becomes enabled again once reminders are switched back on", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, maturityReminder: false },
      });

      render(<NotificationSettings />);
      fireEvent.click(screen.getByRole("switch", { name: "Toggle Maturity Reminders" }));

      expect(screen.getByLabelText("Reminder timing")).not.toBeDisabled();
    });
  });

  describe("reset", () => {
    it("restores every preference to its default", () => {
      useSettingsStore.setState({
        notifications: {
          maturityReminder: false,
          fundingAlerts: false,
          repaymentAlerts: false,
          maturityReminderDays: 7,
        },
      });

      render(<NotificationSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

      expect(prefs()).toEqual(DEFAULT_NOTIFICATION_PREFS);
    });
  });

  describe("tour settings", () => {
    it("reports progress when the tour is neither done nor skipped", () => {
      useSettingsStore.setState({
        tour: { ...DEFAULT_TOUR_SETTINGS, stepIndex: 2 },
      });

      render(<NotificationSettings />);

      // stepIndex is zero-based; the label is not.
      expect(screen.getByText("Step 3")).toBeInTheDocument();
    });

    it.each([
      [{ completed: true, skipped: false }, "tourCompleted"],
      [{ completed: false, skipped: true }, "tourSkipped"],
    ])("reports the finished state %o", (state, expected) => {
      useSettingsStore.setState({ tour: { ...DEFAULT_TOUR_SETTINGS, ...state } });

      render(<NotificationSettings />);

      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("changes the persona", () => {
      render(<NotificationSettings />);

      fireEvent.change(screen.getByLabelText("activePersona"), { target: { value: "sme" } });

      expect(useSettingsStore.getState().tour.persona).toBe("sme");
    });

    it("restarts the tour for the currently selected persona", () => {
      useSettingsStore.setState({ tour: { ...DEFAULT_TOUR_SETTINGS, persona: "sme" } });

      render(<NotificationSettings />);
      fireEvent.click(screen.getByRole("button", { name: "restartTour" }));

      expect(restartTour).toHaveBeenCalledWith("sme");
    });
  });

  describe("keyboard shortcuts", () => {
    it("reflects and toggles the UI store flag", () => {
      render(<NotificationSettings />);

      const toggle = screen.getByRole("switch", { name: "Toggle keyboard shortcuts" });
      expect(toggle).toHaveAttribute("aria-checked", "true");

      fireEvent.click(toggle);

      expect(useUIStore.getState().shortcutsEnabled).toBe(false);
    });
  });

  describe("support diagnostics", () => {
    it("exports a redacted snapshot and releases the object URL", () => {
      const createObjectURL = vi.fn(() => "blob:kora");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

      render(<NotificationSettings />);
      fireEvent.click(screen.getByRole("button", { name: /Export diagnostics JSON/i }));

      expect(exportWalletDiagnostics).toHaveBeenCalled();
      // Not revoking would leak the blob for the lifetime of the document.
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:kora");

      vi.unstubAllGlobals();
    });
  });
});
