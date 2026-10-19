"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { useLocale, useSetLocale } from "@/i18n/LocaleProvider";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleSelect = (next: Locale) => {
    setOpen(false);
    // Re-selecting the active locale is a no-op — no cookie write, no refetch.
    if (next === locale) return;
    // setLocale persists the kora-locale cookie; refreshing re-runs server
    // components so middleware-resolved `lang`/`dir` and the manifest pick up
    // the new locale without a full reload.
    setLocale(next);
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("label")}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm",
          "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        )}
      >
        <Globe className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline font-medium uppercase tracking-wide text-xs">
          {locale}
        </span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("label")}
          className={cn(
            "absolute right-0 rtl:right-auto rtl:left-0 top-full z-50 mt-1.5 min-w-[130px]",
            "rounded-xl border border-border bg-background shadow-lg",
            "overflow-hidden py-1"
          )}
        >
          {locales.map((loc) => (
            <button
              key={loc}
              role="option"
              aria-selected={locale === loc}
              type="button"
              onClick={() => handleSelect(loc)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-sm transition-colors",
                locale === loc
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <span>{localeNames[loc]}</span>
              {locale === loc && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
