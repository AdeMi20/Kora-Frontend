/**
 * Shared theme resolution — the single source of truth for every code path that
 * needs to turn a stored `ThemePreference` into the concrete `light`/`dark`
 * class applied to `<html>`.
 *
 * Three call sites used to resolve the theme independently:
 *  - the inline bootstrap script in `app/layout.tsx` (first paint, no React),
 *  - `components/layout/ThemeProvider.tsx` (after hydration), and
 *  - the `viewport` metadata export (browser chrome color).
 *
 * Keeping the algorithm here means the pre-paint class and the hydrated class
 * cannot drift, so OS dark-mode toggles never fight the first paint. The inline
 * script is generated from these same primitives so it stays byte-compatible
 * with `resolveTheme`.
 */
import { safeStorageGetItem } from "@/store/storageAdapter";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** zustand persist key for `uiStore`, which owns the persisted theme. */
export const THEME_STORAGE_KEY = "kora-ui-store";

/** Fallback theme when storage is unreadable — matches the dark-first design. */
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = "dark";

/**
 * Browser-chrome / PWA colors per resolved theme. `light` mirrors the white
 * surface, `dark` mirrors the zinc-950 dashboard background (`background_color`
 * in `public/manifest.json`), so the address bar blends with the page.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#09090b",
};

/**
 * Resolve an explicit or `system` preference against the OS color-scheme flag.
 * Pure — safe to call during SSR and from tests without a DOM.
 */
export function resolveTheme(
  theme: ThemePreference,
  prefersDark: boolean
): ResolvedTheme {
  if (theme !== "system") return theme;
  return prefersDark ? "dark" : "light";
}

/** Narrow an untrusted value (localStorage payload) to a `ThemePreference`. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Read the persisted theme preference from a `uiStore` payload. Tolerates
 * corrupt JSON, a missing key and a missing `state.theme` by returning
 * `"system"`, which is exactly what the inline bootstrap script falls back to.
 */
export function readThemePreference(
  readItem: (key: string) => string | null = safeStorageGetItem
): ThemePreference {
  const raw = readItem(THEME_STORAGE_KEY);
  if (!raw) return "system";
  try {
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return parseThemePreference(parsed?.state?.theme);
  } catch {
    return "system";
  }
}

/**
 * Viewport `themeColor` entries for `app/layout.tsx`. Kept as a builder so the
 * metadata contract can be asserted in tests without importing the layout
 * (which pulls in `next/font` and env resolution).
 */
export function buildViewportThemeColor(): Array<{ media: string; color: string }> {
  return [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ];
}

/**
 * Keep every `<meta name="theme-color">` tag in sync with the *resolved* theme.
 *
 * The server-rendered viewport export is media-scoped, so it can only track the
 * OS preference — not an in-app override (e.g. OS light + user-picked dark).
 * After hydration this drops the media attribute and forces the resolved color
 * onto each tag, so the browser chrome follows the app, not the OS.
 */
export function applyBrowserThemeColor(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    meta.removeAttribute("media");
    meta.setAttribute("content", THEME_COLORS[resolved]);
  });
}

/**
 * Inline bootstrap script. Runs synchronously before first paint to apply the
 * resolved theme class and prevent a flash of the wrong theme.
 *
 * The resolve expression is the string form of `resolveTheme` above — keep them
 * in lockstep (a unit test executes this script and compares the class it adds
 * against `resolveTheme` for every preference / OS combination).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('${THEME_STORAGE_KEY}')||'{}');var t=(s.state&&s.state.theme)||'system';var r=t==='dark'?'dark':t==='light'?'light':window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.add(r);}catch(e){document.documentElement.classList.add('${DEFAULT_RESOLVED_THEME}');}})();`;
