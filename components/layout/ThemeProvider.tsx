"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import {
  DEFAULT_RESOLVED_THEME,
  applyBrowserThemeColor,
  resolveTheme,
  type ResolvedTheme,
} from "@/lib/theme";

export type { ResolvedTheme };

const ResolvedThemeContext = createContext<ResolvedTheme>(DEFAULT_RESOLVED_THEME);

/** Returns the currently applied (resolved) theme — never "system". */
export function useResolvedTheme(): ResolvedTheme {
  return useContext(ResolvedThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((s) => s.theme);
  const [resolved, setResolved] = useState<ResolvedTheme>(DEFAULT_RESOLVED_THEME);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (mode: ResolvedTheme) => {
      root.classList.remove("light", "dark");
      root.classList.add(mode);
      // Keep browser chrome (address bar / PWA title bar) on the same color as
      // the resolved theme, not the OS preference the server rendered.
      applyBrowserThemeColor(mode);
      setResolved(mode);
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(resolveTheme("system", mq.matches));
      const handler = (e: MediaQueryListEvent) =>
        apply(resolveTheme("system", e.matches));
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }

    apply(resolveTheme(theme, false));
  }, [theme]);

  // Enable CSS transitions only after the first mount so the initial page
  // paint doesn't animate (avoids flash-of-transition on load).
  // The transition rule in globals.css is gated on [data-theme-ready].
  useEffect(() => {
    document.documentElement.dataset.themeReady = "true";
  }, []);

  return (
    <ResolvedThemeContext.Provider value={resolved}>
      {children}
    </ResolvedThemeContext.Provider>
  );
}
