/**
 * ConcentrationRiskAlerts — snooze and dismiss interactions (#943).
 *
 * Snoozes and dismissals live in `useSettingsStore` under
 * `concentration.{snoozes,dismissedKeys}`, persisted to localStorage as
 * `kora-settings-store`, keyed by `dimension:bucket` (see store/settingsStore).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import en from "@/messages/en.json";
import { ConcentrationRiskAlerts } from "../ConcentrationRiskAlerts";
import { DEFAULT_CONCENTRATION_SETTINGS, useSettingsStore } from "@/store/settingsStore";
import { SNOOZE_DURATIONS_MS, type ConcentrationPosition } from "@/lib/concentrationRisk";

const STORAGE_KEY = "kora-settings-store";
const NOW = new Date("2026-10-17T09:00:00Z");

function position(
  investedAmount: number,
  debtorName: string,
  jurisdiction: string,
  riskTier: string
): ConcentrationPosition {
  return { investedAmount, invoice: { riskTier, metadata: { debtorName, jurisdiction } } };
}

// 90% in one debtor/jurisdiction/tier breaches all three default thresholds.
const OVERWEIGHT = [position(900, "Acme Corp", "NG", "BBB"), position(100, "Beta Ltd", "US", "AA")];
const DEBTOR = "debtor:Acme Corp";
const JURISDICTION = "jurisdiction:NG";

function renderAlerts() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConcentrationRiskAlerts positions={OVERWEIGHT} />
    </NextIntlClientProvider>
  );
}

const alertFor = (key: string) => screen.queryByTestId(`concentration-alert-${key}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  act(() => useSettingsStore.setState({ concentration: DEFAULT_CONCENTRATION_SETTINGS }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConcentrationRiskAlerts rendering", () => {
  it("raises an alert per overweight dimension with labelled actions", () => {
    renderAlerts();

    expect(screen.getByRole("region", { name: en.concentrationRisk.title })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(3);

    const alert = within(alertFor(DEBTOR)!);
    expect(alert.getByText("Acme Corp is 90.0% of your portfolio")).toBeInTheDocument();
    expect(alert.getByRole("button", { name: en.concentrationRisk.snoozeDay })).toBeInTheDocument();
    expect(alert.getByRole("button", { name: en.concentrationRisk.snoozeWeek })).toBeInTheDocument();
    expect(alert.getByRole("button", { name: en.concentrationRisk.dismiss })).toBeInTheDocument();
  });

  it("renders nothing for a diversified portfolio", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConcentrationRiskAlerts
          positions={["A", "B", "C", "D", "E"].map((d, i) =>
            position(100, d, ["NG", "US", "KE"][i % 3], ["AAA", "AA", "A"][i % 3])
          )}
        />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId("concentration-risk-alerts")).not.toBeInTheDocument();
  });
});

describe("ConcentrationRiskAlerts snooze", () => {
  it("hides only the snoozed alert until the window elapses", () => {
    const { unmount } = renderAlerts();

    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.snoozeDay })
    );

    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
    expect(alertFor(JURISDICTION)).toBeInTheDocument();
    expect(useSettingsStore.getState().concentration.snoozes).toEqual([
      { key: DEBTOR, until: NOW.getTime() + SNOOZE_DURATIONS_MS.day },
    ]);

    // One minute short of the TTL: still snoozed.
    unmount();
    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.day - 60_000);
    const second = renderAlerts();
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();

    // TTL reached: the alert comes back.
    second.unmount();
    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.day);
    renderAlerts();
    expect(alertFor(DEBTOR)).toBeInTheDocument();
  });

  it("uses the week window and replaces rather than stacks an earlier snooze", () => {
    const { unmount } = renderAlerts();
    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.snoozeDay })
    );
    unmount();

    // Re-snooze for a week once the day snooze has lapsed.
    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.day);
    const second = renderAlerts();
    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.snoozeWeek })
    );

    const { snoozes } = useSettingsStore.getState().concentration;
    expect(snoozes).toHaveLength(1);
    expect(snoozes[0].until).toBe(NOW.getTime() + SNOOZE_DURATIONS_MS.day + SNOOZE_DURATIONS_MS.week);

    second.unmount();
    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.day * 2);
    renderAlerts();
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
  });

  it("snoozes multiple alerts independently", () => {
    const { unmount } = renderAlerts();
    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.snoozeDay })
    );
    fireEvent.click(
      within(alertFor(JURISDICTION)!).getByRole("button", { name: en.concentrationRisk.snoozeWeek })
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    unmount();
    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.day);
    renderAlerts();
    expect(alertFor(DEBTOR)).toBeInTheDocument();
    expect(alertFor(JURISDICTION)).not.toBeInTheDocument();
  });

  it("keeps a snooze active when the system clock moves backwards", () => {
    const { unmount } = renderAlerts();
    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.snoozeDay })
    );
    unmount();

    vi.setSystemTime(NOW.getTime() - 60 * 60 * 1000);
    renderAlerts();
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
  });
});

describe("ConcentrationRiskAlerts dismiss", () => {
  it("persists a dismissal to storage and across a remount", async () => {
    const { unmount } = renderAlerts();

    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.dismiss })
    );
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();

    const persisted = localStorage.getItem(STORAGE_KEY) ?? "{}";
    expect(JSON.parse(persisted).state.concentration.dismissedKeys).toEqual([DEBTOR]);

    // Drop in-memory state and rehydrate from storage, as a fresh page load
    // would. The reset itself persists, so put the saved payload back first.
    unmount();
    act(() => useSettingsStore.setState({ concentration: DEFAULT_CONCENTRATION_SETTINGS }));
    localStorage.setItem(STORAGE_KEY, persisted);
    await act(async () => {
      await useSettingsStore.persist.rehydrate();
    });

    renderAlerts();
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
    expect(alertFor(JURISDICTION)).toBeInTheDocument();
  });

  it("stays dismissed long after any snooze window", () => {
    const { unmount } = renderAlerts();
    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.dismiss })
    );
    unmount();

    vi.setSystemTime(NOW.getTime() + SNOOZE_DURATIONS_MS.week * 10);
    renderAlerts();
    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
  });

  it("still hides the alert when storage rejects the write", () => {
    renderAlerts();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    fireEvent.click(
      within(alertFor(DEBTOR)!).getByRole("button", { name: en.concentrationRisk.dismiss })
    );

    expect(alertFor(DEBTOR)).not.toBeInTheDocument();
    expect(useSettingsStore.getState().concentration.dismissedKeys).toEqual([DEBTOR]);
  });
});
