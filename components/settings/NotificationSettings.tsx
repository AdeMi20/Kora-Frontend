"use client";

import { useEffect, useRef, useState } from "react";
import { Compass, Download, Keyboard, RotateCcw, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore, type MaturityReminderDays, type Persona } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { env } from "@/lib/env";

const NOTIFICATION_ITEMS: Array<{
  key: "maturityReminder" | "fundingAlerts" | "repaymentAlerts";
  label: string;
  description: string;
}> = [
  {
    key: "maturityReminder",
    label: "Maturity Reminders",
    description: "Remind you before invoice maturity date.",
  },
  {
    key: "fundingAlerts",
    label: "Funding Alerts",
    description: "Notify when your invoice reaches funding milestones.",
  },
  {
    key: "repaymentAlerts",
    label: "Repayment Alerts",
    description: "Notify when repayment is due or completed.",
  },
];

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export function NotificationSettings() {
  const t = useTranslations("onboarding");
  const {
    notifications,
    setNotifications,
    resetNotifications,
    tour,
    setTourSettings,
    restartTour,
    setActiveWallet,
  } = useSettingsStore();
  const shortcutsEnabled = useUIStore((s) => s.shortcutsEnabled);
  const setShortcutsEnabled = useUIStore((s) => s.setShortcutsEnabled);
  const { address, exportWalletDiagnostics, importWalletDiagnostics } = useWallet();
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification preferences are scoped per wallet; bind the store's active
  // wallet to the connected one so this surface and the wallet dropdown read
  // and write the same record.
  useEffect(() => {
    setActiveWallet(address ?? null);
  }, [address, setActiveWallet]);

  const handleExportDiagnostics = () => {
    const payload = exportWalletDiagnostics();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kora-wallet-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDiagnostics = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      importWalletDiagnostics(raw);
      setImportStatus("Diagnostics imported for local debug.");
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : "Diagnostics import failed."
      );
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Notification Preferences</h3>
        <p className="text-sm text-muted-foreground">Control which in-app alerts appear during your workflow.</p>
      </div>

      <div className="space-y-3">
        {NOTIFICATION_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Toggle
              checked={notifications[item.key]}
              onChange={(next) => setNotifications({ [item.key]: next })}
              ariaLabel={`Toggle ${item.label}`}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <label htmlFor="maturity-reminder-days" className="block text-sm font-medium text-foreground">
          Reminder timing
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">Choose when to alert before maturity date.</p>
        <select
          id="maturity-reminder-days"
          value={notifications.maturityReminderDays}
          onChange={(e) => setNotifications({ maturityReminderDays: Number(e.target.value) as MaturityReminderDays })}
          className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={!notifications.maturityReminder}
        >
          <option value={1}>1 day before maturity</option>
          <option value={3}>3 days before maturity</option>
          <option value={7}>7 days before maturity</option>
        </select>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={resetNotifications}
      >
        Reset to defaults
      </Button>

      {/* ── Onboarding Tour Settings ────────────────────────────────────── */}
      <div className="space-y-1 pt-2">
        <h3 className="text-base font-semibold text-foreground">Onboarding Tour</h3>
        <p className="text-sm text-muted-foreground">
          {t("restartTourDesc")}
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div>
          <label htmlFor="tour-persona-select" className="block text-xs font-medium text-foreground">
            {t("activePersona")}
          </label>
          <select
            id="tour-persona-select"
            value={tour.persona}
            onChange={(e) => setTourSettings({ persona: e.target.value as Persona })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="investor">{t("personaInvestor")}</option>
            <option value="sme">{t("personaSme")}</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>Status:</span>
          <span className="font-medium text-foreground">
            {tour.completed ? t("tourCompleted") : tour.skipped ? t("tourSkipped") : `Step ${(tour.stepIndex ?? 0) + 1}`}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          leftIcon={<Compass className="h-3.5 w-3.5" />}
          onClick={() => restartTour(tour.persona)}
        >
          {t("restartTour")}
        </Button>
      </div>

      {/* ── Keyboard shortcuts toggle ──────────────────────────────────────── */}
      <div className="space-y-1 pt-2">
        <h3 className="text-base font-semibold text-foreground">Keyboard Shortcuts</h3>
        <p className="text-sm text-muted-foreground">
          Enable global keyboard shortcuts for faster navigation.
        </p>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Enable shortcuts</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">?</kbd> to view all shortcuts.
            </p>
          </div>
        </div>
        <Toggle
          checked={shortcutsEnabled}
          onChange={setShortcutsEnabled}
          ariaLabel="Toggle keyboard shortcuts"
        />
      </div>

      <div className="space-y-2 pt-2">
        <h3 className="text-base font-semibold text-foreground">Support Diagnostics</h3>
        <p className="text-sm text-muted-foreground">
          Export a redacted wallet session snapshot with network and feature-flag state.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={handleExportDiagnostics}
          >
            Export diagnostics JSON
          </Button>
          {env.NEXT_PUBLIC_ENABLE_DEVTOOLS && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportDiagnostics}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => fileInputRef.current?.click()}
              >
                Import diagnostics
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Export includes provider, network, kit session flags, and feature flags. No secrets, seed phrases, JWTs, or full addresses are included.
        </p>
        {importStatus && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {importStatus}
          </p>
        )}
      </div>
    </div>
  );
}

