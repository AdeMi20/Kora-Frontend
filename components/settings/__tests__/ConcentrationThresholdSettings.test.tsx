import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConcentrationThresholdSettings,
  CONCENTRATION_THRESHOLD_MAX,
  CONCENTRATION_THRESHOLD_MIN,
  clampThreshold,
} from "@/components/settings/ConcentrationThresholdSettings";
import {
  DEFAULT_CONCENTRATION_SETTINGS,
  useSettingsStore,
} from "@/store/settingsStore";
import { DEFAULT_CONCENTRATION_THRESHOLDS } from "@/lib/concentrationRisk";

/**
 * Concentration threshold settings (Issue #604).
 *
 * The store is exercised for real: the behaviour worth pinning is that a drag
 * or a typed value lands in `concentration.thresholds` — the same record the
 * investor-dashboard alerts evaluate against — and that out-of-range input is
 * clamped rather than written through as `NaN`.
 */

const wallet = vi.hoisted(() => ({ isConnected: true }));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ isConnected: wallet.isConnected }),
}));

// next-intl needs a provider, and the component interpolates the dimension into
// its aria labels, so the mock preserves that interpolation to keep the three
// controls queryable and distinct.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.dimension ? `${key}:${values.dimension}` : key,
}));

const DIMENSIONS = ["debtor", "jurisdiction", "riskTier"] as const;

function thresholds() {
  return useSettingsStore.getState().concentration.thresholds;
}

describe("clampThreshold", () => {
  it("leaves in-range values untouched", () => {
    expect(clampThreshold(37)).toBe(37);
  });

  it("clamps above the maximum", () => {
    expect(clampThreshold(150)).toBe(CONCENTRATION_THRESHOLD_MAX);
  });

  it("clamps below the minimum", () => {
    expect(clampThreshold(-20)).toBe(CONCENTRATION_THRESHOLD_MIN);
  });

  it("rounds fractional percentages", () => {
    expect(clampThreshold(42.6)).toBe(43);
  });

  it("collapses non-finite input to the minimum instead of propagating NaN", () => {
    expect(clampThreshold(Number.NaN)).toBe(CONCENTRATION_THRESHOLD_MIN);
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(CONCENTRATION_THRESHOLD_MIN);
  });
});

describe("ConcentrationThresholdSettings", () => {
  beforeEach(() => {
    wallet.isConnected = true;
    useSettingsStore.setState({
      concentration: {
        ...DEFAULT_CONCENTRATION_SETTINGS,
        thresholds: { ...DEFAULT_CONCENTRATION_THRESHOLDS },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while the wallet is disconnected", () => {
    wallet.isConnected = false;
    const { container } = render(<ConcentrationThresholdSettings />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a slider and a number input for every dimension", () => {
    render(<ConcentrationThresholdSettings />);

    for (const dimension of DIMENSIONS) {
      const label = `dimensions.${dimension}`;
      expect(
        screen.getByRole("slider", { name: `sliderAria:${label}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("spinbutton", { name: `percentageAria:${label}` }),
      ).toBeInTheDocument();
    }
  });

  it("reflects the stored thresholds", () => {
    useSettingsStore.setState({
      concentration: {
        ...DEFAULT_CONCENTRATION_SETTINGS,
        thresholds: { debtor: 15, jurisdiction: 30, riskTier: 45 },
      },
    });

    render(<ConcentrationThresholdSettings />);

    expect(screen.getByRole("spinbutton", { name: "percentageAria:dimensions.debtor" })).toHaveValue(
      15,
    );
    // Range inputs expose their value as a string, so read it directly rather
    // than relying on jest-dom's number coercion (which only covers `number`).
    const slider = screen.getByRole("slider", {
      name: "sliderAria:dimensions.riskTier",
    }) as HTMLInputElement;
    expect(slider.value).toBe("45");
  });

  it("writes a slider move to the store without touching the other dimensions", () => {
    render(<ConcentrationThresholdSettings />);

    fireEvent.change(screen.getByRole("slider", { name: "sliderAria:dimensions.debtor" }), {
      target: { value: "33" },
    });

    expect(thresholds()).toEqual({
      ...DEFAULT_CONCENTRATION_THRESHOLDS,
      debtor: 33,
    });
  });

  it("clamps a typed value above 100 on blur", () => {
    render(<ConcentrationThresholdSettings />);
    const input = screen.getByRole("spinbutton", { name: "percentageAria:dimensions.jurisdiction" });

    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input, { target: { value: "250" } });

    expect(thresholds().jurisdiction).toBe(CONCENTRATION_THRESHOLD_MAX);
  });

  it("clamps a typed negative value up to 0 on blur", () => {
    render(<ConcentrationThresholdSettings />);
    const input = screen.getByRole("spinbutton", { name: "percentageAria:dimensions.riskTier" });

    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input, { target: { value: "-5" } });

    expect(thresholds().riskTier).toBe(CONCENTRATION_THRESHOLD_MIN);
  });

  it("restores the stored value when the field is cleared", () => {
    render(<ConcentrationThresholdSettings />);
    const input = screen.getByRole("spinbutton", { name: "percentageAria:dimensions.debtor" });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input, { target: { value: "" } });

    expect(thresholds().debtor).toBe(DEFAULT_CONCENTRATION_THRESHOLDS.debtor);
  });

  it("restores every threshold to its default on reset", () => {
    useSettingsStore.getState().setConcentrationThresholds({
      debtor: 10,
      jurisdiction: 10,
      riskTier: 10,
    });

    render(<ConcentrationThresholdSettings />);
    fireEvent.click(screen.getByRole("button", { name: "resetToDefaults" }));

    expect(thresholds()).toEqual(DEFAULT_CONCENTRATION_THRESHOLDS);
  });
});
