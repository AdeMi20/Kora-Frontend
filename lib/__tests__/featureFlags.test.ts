import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISALLOWED_OVERRIDE_FLAGS,
  getFeatureFlagOverride,
  isEnabled,
  isFlagOverrideAllowed,
  resetFeatureFlagOverrides,
  setFeatureFlagOverride,
} from "../featureFlags";

const STORAGE_KEY = "kora:feature-flag-overrides";

function storedOverrides(): Record<string, boolean> | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
}

describe("featureFlags runtime override restrictions (Issue #1025)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK_DATA", "false");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SECONDARY_MARKET", "false");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_COMPARISON", "false");
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("lists mock-data and secondary-market as disallowed overrides", () => {
    expect(DISALLOWED_OVERRIDE_FLAGS).toEqual(["mock-data", "secondary-market"]);
  });

  describe("outside development (staging-style build)", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "test");
    });

    it.each(DISALLOWED_OVERRIDE_FLAGS)("reports %s as not overridable", (flag) => {
      expect(isFlagOverrideAllowed(flag)).toBe(false);
    });

    it("still allows overriding other flags", () => {
      expect(isFlagOverrideAllowed("comparison")).toBe(true);
      setFeatureFlagOverride("comparison", true);
      expect(isEnabled("comparison")).toBe(true);
      expect(storedOverrides()).toEqual({ comparison: true });
    });

    it("ignores setFeatureFlagOverride writes for mock-data", () => {
      setFeatureFlagOverride("mock-data", true);
      expect(storedOverrides()).toBeNull();
      expect(isEnabled("mock-data")).toBe(false);
    });

    it("ignores setFeatureFlagOverride writes for secondary-market", () => {
      setFeatureFlagOverride("secondary-market", true);
      expect(storedOverrides()).toBeNull();
      expect(isEnabled("secondary-market")).toBe(false);
    });

    it("ignores manually edited localStorage values for disallowed flags", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ "mock-data": true, "secondary-market": true, comparison: true }),
      );

      expect(isEnabled("mock-data")).toBe(false);
      expect(isEnabled("secondary-market")).toBe(false);
      expect(getFeatureFlagOverride("mock-data")).toBeUndefined();
      expect(getFeatureFlagOverride("secondary-market")).toBeUndefined();
      expect(isEnabled("comparison")).toBe(true);
    });

    it("drops tampered disallowed keys from storage on the next write", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ "mock-data": true, comparison: true }),
      );

      setFeatureFlagOverride("batch-actions", true);

      expect(storedOverrides()).toEqual({ comparison: true, "batch-actions": true });
    });

    it("falls back to the env value for disallowed flags", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK_DATA", "true");
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ "mock-data": false }));

      expect(isEnabled("mock-data")).toBe(true);
    });
  });

  describe("in development", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    it.each(DISALLOWED_OVERRIDE_FLAGS)("allows overriding %s", (flag) => {
      expect(isFlagOverrideAllowed(flag)).toBe(true);
      setFeatureFlagOverride(flag, true);
      expect(isEnabled(flag)).toBe(true);
      expect(getFeatureFlagOverride(flag)).toBe(true);
    });

    it("honours manually edited localStorage values", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ "mock-data": true, "secondary-market": true }),
      );

      expect(isEnabled("mock-data")).toBe(true);
      expect(isEnabled("secondary-market")).toBe(true);
    });

    it("clears overrides on reset", () => {
      setFeatureFlagOverride("mock-data", true);
      resetFeatureFlagOverrides();
      expect(storedOverrides()).toBeNull();
      expect(isEnabled("mock-data")).toBe(false);
    });
  });

  describe("in production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    it("ignores all runtime overrides", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ "mock-data": true, comparison: true }),
      );

      expect(isEnabled("mock-data")).toBe(false);
      expect(isEnabled("comparison")).toBe(false);
    });
  });
});
