/**
 * LanguageSwitcher — locale cookie sync, router refresh and axe (Issue #1011).
 *
 * Middleware resolves the request locale from the `kora-locale` cookie, so a
 * switch that updates client state but not the cookie (or never refreshes the
 * server tree) leaves RTL layout and the manifest `lang` stale on the next
 * request. These tests pin both halves:
 *
 *  - **Mocked context** — LanguageSwitcher calls the provider's `setLocale`
 *    for every supported locale and refreshes the router.
 *  - **Real provider** — the selection writes the cookie middleware reads and
 *    updates `<html lang dir>`.
 *
 * axe-core runs against the closed trigger and the open listbox in both LTR
 * and RTL locales; any serious or critical violation fails the suite.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { LOCALE_COOKIE_NAME, getCookieLocale } from "@/i18n/locale";

import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import arMessages from "@/messages/ar.json";
import ptBRMessages from "@/messages/pt-BR.json";

const ALL_MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: enMessages as Record<string, unknown>,
  es: esMessages as Record<string, unknown>,
  ar: arMessages as Record<string, unknown>,
  "pt-BR": ptBRMessages as Record<string, unknown>,
};

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/**
 * When `mockContext` is set, the LocaleProvider hooks read from it instead of
 * the real context — lets one file cover both the mocked-context contract and
 * the real cookie integration.
 */
let mockContext: { locale: Locale; setLocale: (l: Locale) => void } | null = null;

vi.mock("@/i18n/LocaleProvider", async () => {
  const actual = await vi.importActual<typeof import("@/i18n/LocaleProvider")>(
    "@/i18n/LocaleProvider",
  );
  return {
    ...actual,
    useLocale: () => (mockContext ? mockContext.locale : actual.useLocale()),
    useSetLocale: () => (mockContext ? mockContext.setLocale : actual.useSetLocale()),
  };
});

function clearLocaleCookie() {
  document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
}

function getTrigger() {
  return document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getTrigger());
  return screen.getByRole("listbox");
}

async function expectNoSeriousAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom has no layout or canvas, so contrast cannot be computed.
      "color-contrast": { enabled: false },
      // The switcher is rendered in isolation, outside any landmark.
      region: { enabled: false },
    },
  });
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target).join(", ")})`),
  ).toEqual([]);
}

/** A locale other than `target`, so selecting `target` is a real change. */
function startingLocaleFor(target: Locale): Locale {
  return target === "en" ? "es" : "en";
}

beforeEach(() => {
  refresh.mockClear();
  mockContext = null;
  clearLocaleCookie();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  clearLocaleCookie();
});

// ─── Mocked LocaleProvider context ────────────────────────────────────────────

describe("LanguageSwitcher with mocked LocaleProvider context", () => {
  function renderWithMockContext(locale: Locale) {
    const setLocale = vi.fn();
    mockContext = { locale, setLocale };
    render(
      <NextIntlClientProvider locale={locale} messages={ALL_MESSAGES[locale]}>
        <LanguageSwitcher />
      </NextIntlClientProvider>,
    );
    return setLocale;
  }

  it("lists every supported locale as an option", async () => {
    const user = userEvent.setup();
    renderWithMockContext("en");
    const listbox = await openMenu(user);

    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(locales.length);
    for (const loc of locales) {
      expect(within(listbox).getByRole("option", { name: localeNames[loc] })).toBeInTheDocument();
    }
  });

  it("marks only the active locale as selected", async () => {
    const user = userEvent.setup();
    renderWithMockContext("ar");
    const listbox = await openMenu(user);

    for (const loc of locales) {
      expect(within(listbox).getByRole("option", { name: localeNames[loc] })).toHaveAttribute(
        "aria-selected",
        String(loc === "ar"),
      );
    }
  });

  it.each(locales)("selecting %s calls setLocale and refreshes the router", async (target) => {
    const user = userEvent.setup();
    const setLocale = renderWithMockContext(startingLocaleFor(target));
    const listbox = await openMenu(user);

    await user.click(within(listbox).getByRole("option", { name: localeNames[target] }));

    expect(setLocale).toHaveBeenCalledTimes(1);
    expect(setLocale).toHaveBeenCalledWith(target);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("re-selecting the active locale closes the menu without persisting or refreshing", async () => {
    const user = userEvent.setup();
    const setLocale = renderWithMockContext("es");
    const listbox = await openMenu(user);

    await user.click(within(listbox).getByRole("option", { name: localeNames.es }));

    expect(setLocale).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("reflects open state through aria-expanded", async () => {
    const user = userEvent.setup();
    renderWithMockContext("en");
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");

    await openMenu(user);
    expect(getTrigger()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
  });
});

// ─── Real LocaleProvider: cookie persistence ─────────────────────────────────

describe("LanguageSwitcher with the real LocaleProvider", () => {
  function renderWithProvider(initialLocale: Locale) {
    return render(
      <LocaleProvider allMessages={ALL_MESSAGES} initialLocale={initialLocale}>
        <LanguageSwitcher />
      </LocaleProvider>,
    );
  }

  it.each(locales)("selecting %s writes the kora-locale cookie read by middleware", async (target) => {
    const user = userEvent.setup();
    renderWithProvider(startingLocaleFor(target));
    const listbox = await openMenu(user);

    await user.click(within(listbox).getByRole("option", { name: localeNames[target] }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=${encodeURIComponent(target)}`);
    expect(getCookieLocale()).toBe(target);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("switching to Arabic flips the document to RTL", async () => {
    const user = userEvent.setup();
    renderWithProvider("en");
    const listbox = await openMenu(user);

    await user.click(within(listbox).getByRole("option", { name: localeNames.ar }));

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("re-selecting the active locale leaves the cookie untouched", async () => {
    const user = userEvent.setup();
    renderWithProvider("en");
    const listbox = await openMenu(user);

    await user.click(within(listbox).getByRole("option", { name: localeNames.en }));

    expect(getCookieLocale()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still switches the UI locale when the browser blocks cookies", async () => {
    // Browsers with cookies disabled silently drop writes to document.cookie.
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => {},
    });
    try {
      const user = userEvent.setup();
      renderWithProvider("en");
      const listbox = await openMenu(user);

      await user.click(within(listbox).getByRole("option", { name: localeNames.es }));

      expect(getCookieLocale()).toBeNull();
      expect(document.documentElement.lang).toBe("es");
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      // Remove the instance override so Document.prototype.cookie applies again.
      delete (document as unknown as { cookie?: string }).cookie;
    }
  });
});

// ─── Accessibility ───────────────────────────────────────────────────────────

describe("LanguageSwitcher accessibility (axe)", () => {
  function renderWithProvider(initialLocale: Locale) {
    return render(
      <LocaleProvider allMessages={ALL_MESSAGES} initialLocale={initialLocale}>
        <LanguageSwitcher />
      </LocaleProvider>,
    );
  }

  it("has no serious violations when closed", async () => {
    const { container } = renderWithProvider("en");
    await expectNoSeriousAxeViolations(container);
  });

  it.each(locales)("has no serious violations with the menu open in %s", async (loc) => {
    const user = userEvent.setup();
    const { container } = renderWithProvider(loc);
    await openMenu(user);
    await expectNoSeriousAxeViolations(container);
  });
});
