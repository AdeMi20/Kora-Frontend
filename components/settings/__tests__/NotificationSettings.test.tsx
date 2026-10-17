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
 * Notification preference UI (Issue #767 / i18n pass).
 *
 * The store is exercised for real rather than mocked: the thing worth testing
 * is that a toggle writes the preference the rest of the app reads, and a
 * mocked store would assert only that a spy was called with an object.
 *
 * next-intl is mocked to return English strings from the message catalogue so
 * assertions remain readable and test the full render path without needing a
 * real IntlProvider. The mock handles two namespaces used by this component:
 *   - "settings.notifications"  (notification prefs, shortcuts, diagnostics)
 *   - "onboarding"              (tour controls — unchanged from before)
 */

const { restartTour, exportWalletDiagnostics, importWalletDiagnostics } = vi.hoisted(() => ({
  restartTour: vi.fn(),
  exportWalletDiagnostics: vi.fn(() => ({ network: "testnet" })),
  importWalletDiagnostics: vi.fn(),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ exportWalletDiagnostics, importWalletDiagnostics }),
}));

// Env validation throws at import time without these vars
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
    NEXT_PUBLIC_ENABLE_DEVTOOLS: false,
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://rpc.testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NEXT_PUBLIC_INVOICE_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_TOKEN_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs/",
  },
}));

// Flat English string tables for both namespaces used by NotificationSettings.
const NOTIFICATIONS_STRINGS: Record<string, string> = {
  sectionTitle: "Notification Preferences",
  sectionDesc: "Control which in-app alerts appear during your workflow.",
  "maturityReminder.label": "Maturity Reminders",
  "maturityReminder.description": "Remind you before invoice maturity date.",
  "fundingAlerts.label": "Funding Alerts",
  "fundingAlerts.description": "Notify when your invoice reaches funding milestones.",
  "repaymentAlerts.label": "Repayment Alerts",
  "repaymentAlerts.description": "Notify when repayment is due or completed.",
  "reminderTiming.label": "Reminder timing",
  "reminderTiming.description": "Choose when to alert before maturity date.",
  "reminderTiming.day1": "1 day before maturity",
  "reminderTiming.day3": "3 days before maturity",
  "reminderTiming.day7": "7 days before maturity",
  resetDefaults: "Reset to defaults",
  // Interpolated: "Toggle {label}" → return key so tests can predict the value
  toggleAriaLabel: "toggleAriaLabel",
  "tourSection.title": "Onboarding Tour",
  "shortcutsSection.title": "Keyboard Shortcuts",
  "shortcutsSection.description": "Enable global keyboard shortcuts for faster navigation.",
  "shortcutsSection.enableLabel": "Enable shortcuts",
  "shortcutsSection.enableDesc": "Press ? to view all shortcuts.",
  "shortcutsSection.toggleAriaLabel": "Toggle keyboard shortcuts",
  "diagnosticsSection.title": "Support Diagnostics",
  "diagnosticsSection.description": "Export a redacted wallet session snapshot with network and feature-flag state.",
  "diagnosticsSection.exportButton": "Export diagnostics JSON",
  "diagnosticsSection.importButton": "Import diagnostics",
  "diagnosticsSection.exportNote": "Export includes provider, network, kit session flags, and feature flags. No secrets, seed phrases, JWTs, or full addresses are included.",
  "diagnosticsSection.importSuccess": "Diagnostics imported for local debug.",
  "diagnosticsSection.importFailed": "Diagnostics import failed.",
};

const ONBOARDING_STRINGS: Record<string, string> = {
  restartTourDesc: "You can restart the guided tour at any time.",
  activePersona: "activePersona",
  personaInvestor: "Investor",
  personaSme: "SME",
  tourCompleted: "tourCompleted",
  tourSkipped: "tourSkipped",
  restartTour: "restartTour",
};

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const table =
      namespace === "settings.notifications"
        ? NOTIFICATIONS_STRINGS
        : ONBOARDING_STRINGS;

    // Supports both plain keys and interpolated keys (params ignored for simplicity).
    return (key: string) => table[key] ?? key;
  },
}));

// ── Derived label helpers (match what the component renders) ──────────────────
// The component calls: t("toggleAriaLabel", { label: item.label })
// The mock returns the key "toggleAriaLabel" regardless of params.
// Tests that need a per-item aria-label must use this constant.
const TOGGLE_ARIA_KEY = "toggleAriaLabel";

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

  // ── Section headings ────────────────────────────────────────────────────────
  describe("section headings", () => {
    it("renders translated section heading for notifications", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("Notification Preferences")).toBeInTheDocument();
    });

    it("renders translated heading for keyboard shortcuts", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    });

    it("renders translated heading for support diagnostics", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("Support Diagnostics")).toBeInTheDocument();
    });
  });

  // ── Preference toggles ──────────────────────────────────────────────────────
  describe("preference toggles", () => {
    it("renders three switches, reflecting stored values", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, fundingAlerts: false },
      });

      render(<NotificationSettings />);

      // All three switches are rendered (aria-label is the translated key)
      const switches = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      expect(switches).toHaveLength(3);

      // Verify aria-checked reflects the store correctly by checking all values
      const checkedValues = switches.map((s) => s.getAttribute("aria-checked"));
      expect(checkedValues).toContain("true");
      expect(checkedValues).toContain("false");
    });

    it("clicking the first toggle (maturity reminder) writes false to store", () => {
      render(<NotificationSettings />);

      const [firstSwitch] = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(firstSwitch);

      expect(prefs().maturityReminder).toBe(false);
    });

    it("clicking the second toggle (funding alerts) writes false to store", () => {
      render(<NotificationSettings />);

      const switches = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(switches[1]);

      expect(prefs().fundingAlerts).toBe(false);
    });

    it("clicking the third toggle (repayment alerts) writes false to store", () => {
      render(<NotificationSettings />);

      const switches = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(switches[2]);

      expect(prefs().repaymentAlerts).toBe(false);
    });

    it("switching a preference back on restores true", () => {
      useSettingsStore.setState({
        notifications: { ...DEFAULT_NOTIFICATION_PREFS, repaymentAlerts: false },
      });

      render(<NotificationSettings />);
      const switches = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(switches[2]);

      expect(prefs().repaymentAlerts).toBe(true);
    });

    it("leaves other preferences untouched when toggling funding alerts", () => {
      render(<NotificationSettings />);

      const switches = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(switches[1]);

      expect(prefs()).toEqual({
        ...DEFAULT_NOTIFICATION_PREFS,
        fundingAlerts: false,
      });
    });

    it("renders translated labels for notification items", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("Maturity Reminders")).toBeInTheDocument();
      expect(screen.getByText("Funding Alerts")).toBeInTheDocument();
      expect(screen.getByText("Repayment Alerts")).toBeInTheDocument();
    });
  });

  // ── Reminder timing ─────────────────────────────────────────────────────────
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
      const [firstSwitch] = screen.getAllByRole("switch", { name: TOGGLE_ARIA_KEY });
      fireEvent.click(firstSwitch);

      expect(screen.getByLabelText("Reminder timing")).not.toBeDisabled();
    });

    it("renders translated option labels", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("1 day before maturity")).toBeInTheDocument();
      expect(screen.getByText("3 days before maturity")).toBeInTheDocument();
      expect(screen.getByText("7 days before maturity")).toBeInTheDocument();
    });
  });

  // ── Reset ───────────────────────────────────────────────────────────────────
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

  // ── Tour settings ───────────────────────────────────────────────────────────
  describe("tour settings", () => {
    it("reports progress when the tour is neither done nor skipped", () => {
      useSettingsStore.setState({
        tour: { ...DEFAULT_TOUR_SETTINGS, stepIndex: 2 },
      });

      render(<NotificationSettings />);

      // stepIndex is zero-based; the label shows stepIndex + 1
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

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  describe("keyboard shortcuts", () => {
    it("reflects and toggles the UI store flag", () => {
      render(<NotificationSettings />);

      const toggle = screen.getByRole("switch", { name: "Toggle keyboard shortcuts" });
      expect(toggle).toHaveAttribute("aria-checked", "true");

      fireEvent.click(toggle);

      expect(useUIStore.getState().shortcutsEnabled).toBe(false);
    });

    it("renders translated enable label", () => {
      render(<NotificationSettings />);
      expect(screen.getByText("Enable shortcuts")).toBeInTheDocument();
    });
  });

  // ── Support diagnostics ─────────────────────────────────────────────────────
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
