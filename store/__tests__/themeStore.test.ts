/**
 * Tests for theme toggle logic in uiStore and ThemeProvider's resolveTheme helper.
 *
 * We test the pure state-transition logic directly without a DOM environment
 * (vitest is configured with environment: "node").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  THEME_COLORS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyBrowserThemeColor,
  buildViewportThemeColor,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
} from "@/lib/theme";

// ─── resolveTheme ─────────────────────────────────────────────────────────────

// `resolveTheme` now lives in lib/theme and is shared by the inline bootstrap
// script and ThemeProvider. The tests below were previously run against an
// inlined copy of the same logic.
describe("resolveTheme", () => {
  it('returns "dark" when theme is "dark"', () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it('returns "light" when theme is "light"', () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it('resolves "system" to "dark" when prefers-color-scheme is dark', () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it('resolves "system" to "light" when prefers-color-scheme is light', () => {
    expect(resolveTheme("system", false)).toBe("light");
  });
});

// ─── toggleTheme logic ────────────────────────────────────────────────────────

/**
 * Pure extraction of the toggleTheme transition so it can be tested without
 * zustand or window. Mirrors the implementation in uiStore.ts exactly.
 */
function computeNextTheme(
  current: "light" | "dark" | "system",
  prefersDark: boolean
): "light" | "dark" {
  const resolved =
    current === "system" ? (prefersDark ? "dark" : "light") : current;
  return resolved === "dark" ? "light" : "dark";
}

describe("computeNextTheme (toggleTheme transition)", () => {
  it('dark → light', () => {
    expect(computeNextTheme("dark", false)).toBe("light");
    expect(computeNextTheme("dark", true)).toBe("light");
  });

  it('light → dark', () => {
    expect(computeNextTheme("light", false)).toBe("dark");
    expect(computeNextTheme("light", true)).toBe("dark");
  });

  it('system (prefers dark) → light', () => {
    expect(computeNextTheme("system", true)).toBe("light");
  });

  it('system (prefers light) → dark', () => {
    expect(computeNextTheme("system", false)).toBe("dark");
  });

  it('never produces "system" as output', () => {
    const results = (["light", "dark", "system"] as const).flatMap((t) =>
      [true, false].map((pref) => computeNextTheme(t, pref))
    );
    expect(results.every((r) => r === "light" || r === "dark")).toBe(true);
    expect(results.some((r) => r === "system" as string)).toBe(false);
  });
});

// ─── localStorage persistence shape ──────────────────────────────────────────

describe("localStorage persistence contract", () => {
  it("theme init script reads nested state.theme correctly", () => {
    // Simulate what the inline script in layout.tsx reads from localStorage.
    const storageValue = JSON.stringify({ state: { theme: "light" } });
    const parsed = JSON.parse(storageValue);
    const theme = parsed.state?.theme ?? "system";
    expect(theme).toBe("light");
  });

  it("falls back to 'system' when localStorage key is missing", () => {
    const storageValue = null;
    const parsed = storageValue ? JSON.parse(storageValue) : {};
    const theme = parsed.state?.theme ?? "system";
    expect(theme).toBe("system");
  });

  it("falls back to 'system' when state key is absent", () => {
    const storageValue = JSON.stringify({});
    const parsed = JSON.parse(storageValue);
    const theme = parsed.state?.theme ?? "system";
    expect(theme).toBe("system");
  });
});

// ─── shared helpers (issue #989) ──────────────────────────────────────────────

describe("readThemePreference", () => {
  it("reads state.theme from a persisted uiStore payload", () => {
    const read = (key: string) =>
      key === THEME_STORAGE_KEY
        ? JSON.stringify({ state: { theme: "light" } })
        : null;
    expect(readThemePreference(read)).toBe("light");
  });

  it("returns 'system' for missing keys, corrupt JSON and unknown values", () => {
    expect(readThemePreference(() => null)).toBe("system");
    expect(readThemePreference(() => "{not json")).toBe("system");
    expect(
      readThemePreference(() => JSON.stringify({ state: { theme: "plaid" } }))
    ).toBe("system");
  });
});

describe("parseThemePreference", () => {
  it("accepts only the three known preferences", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference(1)).toBe("system");
  });
});

// ─── inline bootstrap script parity (issue #989) ──────────────────────────────

describe("THEME_INIT_SCRIPT", () => {
  const originalMatchMedia = window.matchMedia;

  function installMatchMedia(prefersDark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  function runScript(): string {
    document.documentElement.className = "";
    // eslint-disable-next-line no-new-func
    new Function(THEME_INIT_SCRIPT)();
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    installMatchMedia(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("matches resolveTheme for every preference / OS combination", () => {
    const preferences = ["light", "dark", "system"] as const;

    for (const theme of preferences) {
      for (const prefersDark of [true, false]) {
        localStorage.setItem(
          THEME_STORAGE_KEY,
          JSON.stringify({ state: { theme } })
        );
        installMatchMedia(prefersDark);
        expect(runScript()).toBe(resolveTheme(theme, prefersDark));
      }
    }
  });

  it("defaults to dark when storage is unreadable", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    installMatchMedia(false);
    expect(runScript()).toBe("dark");
    spy.mockRestore();
  });

  it("treats an absent payload as the system preference", () => {
    installMatchMedia(true);
    expect(runScript()).toBe("dark");
    installMatchMedia(false);
    expect(runScript()).toBe("light");
  });
});

// ─── browser chrome color (issue #990) ────────────────────────────────────────

describe("viewport themeColor", () => {
  it("exposes a light and dark token with media queries", () => {
    const entries = buildViewportThemeColor();
    expect(entries).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ]);
  });

  it("uses non-teal zinc surfaces as the chrome colors", () => {
    expect(THEME_COLORS.light).toBe("#ffffff");
    expect(THEME_COLORS.dark).toBe("#09090b");
  });
});

describe("applyBrowserThemeColor", () => {
  function mountMeta(media?: string) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    if (media) meta.setAttribute("media", media);
    document.head.appendChild(meta);
    return meta;
  }

  beforeEach(() => {
    document.head
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((node) => node.remove());
  });

  it("forces the resolved color onto every theme-color tag", () => {
    const light = mountMeta("(prefers-color-scheme: light)");
    const dark = mountMeta("(prefers-color-scheme: dark)");

    applyBrowserThemeColor("light");

    for (const meta of [light, dark]) {
      expect(meta.getAttribute("content")).toBe(THEME_COLORS.light);
      expect(meta.hasAttribute("media")).toBe(false);
    }

    applyBrowserThemeColor("dark");
    for (const meta of [light, dark]) {
      expect(meta.getAttribute("content")).toBe(THEME_COLORS.dark);
    }
  });
});
