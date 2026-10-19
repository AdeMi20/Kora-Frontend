"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, X, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

function useSafeCommonTranslations() {
  try {
    return useTranslations("common");
  } catch {
    return null;
  }
}

function useSafeUiSelectTranslations() {
  try {
    return useTranslations("ui.select");
  } catch {
    return null;
  }
}

export interface Option {
  value: string;
  label: string;
}

export interface OptionGroup {
  label: string;
  options: Option[];
}

export type SelectOption = Option | OptionGroup;

export interface SelectProps {
  label?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
  value?: string | string[];
  onChange?: (value: any) => void;
  isMulti?: boolean;
  isSearchable?: boolean;
  loading?: boolean;
  loadOptions?: (query: string) => Promise<SelectOption[]>;
  className?: string;
  disabled?: boolean;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLSelectElement>;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-required"?: React.AriaAttributes["aria-required"];
  "aria-describedby"?: string;
}

function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-kora-500/30 text-kora-300 font-semibold rounded-[2px] px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}

const getFlattenedOptions = (opts: SelectOption[]): Option[] => {
  const flat: Option[] = [];
  opts.forEach((opt) => {
    if ("options" in opt && Array.isArray(opt.options)) {
      opt.options.forEach((subOpt) => {
        flat.push(subOpt);
      });
    } else {
      flat.push(opt as Option);
    }
  });
  return flat;
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      options = [],
      placeholder,
      value,
      onChange,
      onBlur,
      name,
      isMulti = false,
      isSearchable = false,
      loading = false,
      loadOptions,
      className,
      disabled = false,
      id,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    forwardedRef
  ) => {
    const t = useSafeCommonTranslations();
    const tSelect = useSafeUiSelectTranslations();
    const effectivePlaceholder = placeholder ?? t?.("selectOption") ?? "Select option...";
    const searchPlaceholder = t?.("searchOptions") ?? "Search options...";
    const loadingText = tSelect?.("loading") ?? "Loading options…";
    const loadErrorText = tSelect?.("loadError") ?? "Could not load options";
    const retryText = t?.("retry") ?? "Retry";

    const [isOpen, setIsOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [asyncOptions, setAsyncOptions] = React.useState<SelectOption[]>([]);
    const [isLoadingAsync, setIsLoadingAsync] = React.useState(Boolean(loadOptions));
    const [asyncError, setAsyncError] = React.useState<string | null>(null);
    const [liveAnnouncement, setLiveAnnouncement] = React.useState("");

    const isBusy = Boolean(loading || isLoadingAsync);
    const prevBusyRef = React.useRef(isBusy);

    const generatedId = React.useId();
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : `select-${generatedId}`);
    const labelId = label ? `${selectId}-label` : undefined;
    const listboxId = `${selectId}-listbox`;
    const errorId = `${selectId}-error`;
    const ariaDescribedBy = [
      error ? errorId : null,
      props["aria-describedby"] ? String(props["aria-describedby"]) : null,
    ]
      .filter(Boolean)
      .join(" ");
    const hiddenSelectRef = React.useRef<HTMLSelectElement>(null);

    // Combine external ref with internal ref
    React.useImperativeHandle(forwardedRef, () => hiddenSelectRef.current!);

    // Handle internal selected values
    const [selectedValues, setSelectedValues] = React.useState<string | string[]>(
      value !== undefined ? value : isMulti ? [] : ""
    );

    React.useEffect(() => {
      if (value !== undefined) {
        setSelectedValues(value);
      }
    }, [value]);

    const runLoadOptions = React.useCallback(
      async (query: string) => {
        if (!loadOptions) return;
        setIsLoadingAsync(true);
        setAsyncError(null);
        try {
          const results = await loadOptions(query);
          setAsyncOptions(Array.isArray(results) ? results : []);
        } catch (err) {
          console.error("Error loading async options:", err);
          setAsyncOptions([]);
          setAsyncError(loadErrorText);
        } finally {
          setIsLoadingAsync(false);
        }
      },
      [loadOptions, loadErrorText]
    );

    const hasLoadedInitialRef = React.useRef(false);

    // Handle Async Search with Debounce
    React.useEffect(() => {
      if (!loadOptions) return;

      if (!hasLoadedInitialRef.current && searchQuery === "") {
        hasLoadedInitialRef.current = true;
        void runLoadOptions("");
        return;
      }

      setIsLoadingAsync(true);
      setAsyncError(null);
      const delayDebounce = setTimeout(() => {
        void runLoadOptions(searchQuery);
      }, 300);

      return () => clearTimeout(delayDebounce);
    }, [searchQuery, loadOptions, runLoadOptions]);

    const sourceOptions = loadOptions ? asyncOptions : options;
    const activeOptions = React.useMemo(
      () => getFlattenedOptions(sourceOptions),
      [sourceOptions]
    );

    // Announce loading and completion states via polite live region
    React.useEffect(() => {
      if (isBusy) {
        setLiveAnnouncement(loadingText);
      } else if (prevBusyRef.current) {
        if (asyncError || error) {
          setLiveAnnouncement(asyncError || error || loadErrorText);
        } else {
          const count = activeOptions.length;
          const completedMsg =
            tSelect?.("optionsLoaded", { count }) ??
            (count === 0
              ? "No options available"
              : count === 1
                ? "1 option available"
                : `${count} options available`);
          setLiveAnnouncement(completedMsg);
        }
      }
      prevBusyRef.current = isBusy;
    }, [isBusy, loadingText, asyncError, error, loadErrorText, activeOptions.length, tSelect]);

    // Filter standard options if searchable
    const filteredOptions = React.useMemo(() => {
      if (loadOptions || !isSearchable || !searchQuery) return sourceOptions;

      const query = searchQuery.toLowerCase();

      return sourceOptions
        .map((opt) => {
          if ("options" in opt && Array.isArray(opt.options)) {
            const matchedSubs = opt.options.filter((sub) =>
              sub.label.toLowerCase().includes(query)
            );
            return matchedSubs.length > 0 ? { ...opt, options: matchedSubs } : null;
          } else {
            return opt.label.toLowerCase().includes(query) ? opt : null;
          }
        })
        .filter(Boolean) as SelectOption[];
    }, [sourceOptions, searchQuery, isSearchable, loadOptions]);

    const handleSelectValue = (newValue: string) => {
      let finalValue: string | string[];

      if (isMulti) {
        const currentValues = Array.isArray(selectedValues) ? selectedValues : [];
        if (currentValues.includes(newValue)) {
          finalValue = currentValues.filter((v) => v !== newValue);
        } else {
          finalValue = [...currentValues, newValue];
        }
      } else {
        finalValue = newValue;
        setIsOpen(false);
      }

      setSelectedValues(finalValue);

      // Propagate value change to form element/handlers
      if (hiddenSelectRef.current) {
        if (isMulti) {
          Array.from(hiddenSelectRef.current.options).forEach((opt) => {
            opt.selected = (finalValue as string[]).includes(opt.value);
          });
        } else {
          hiddenSelectRef.current.value = finalValue as string;
        }
        const event = new Event("change", { bubbles: true });
        hiddenSelectRef.current.dispatchEvent(event);
      }

      if (onChange) {
        if (name) {
          // React-hook-form registered change event simulation
          onChange({
            target: {
              name,
              value: finalValue,
            },
          });
        } else {
          onChange(finalValue);
        }
      }
    };

    const removeValue = React.useCallback((valToRemove: string, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const currentValues = Array.isArray(selectedValues) ? selectedValues : [];
      const finalValue = currentValues.filter((v) => v !== valToRemove);

      setSelectedValues(finalValue);

      if (hiddenSelectRef.current) {
        Array.from(hiddenSelectRef.current.options).forEach((opt) => {
          opt.selected = finalValue.includes(opt.value);
        });
        const event = new Event("change", { bubbles: true });
        hiddenSelectRef.current.dispatchEvent(event);
      }

      if (onChange) {
        if (name) {
          onChange({
            target: {
              name,
              value: finalValue,
            },
          });
        } else {
          onChange(finalValue);
        }
      }
    }, [selectedValues, onChange, name]);

    const isSelected = (val: string) => {
      if (isMulti) {
        return Array.isArray(selectedValues) && selectedValues.includes(val);
      }
      return selectedValues === val;
    };

    // Find display label for single select
    const selectedLabel = React.useMemo(() => {
      if (isMulti) return null;
      const found = activeOptions.find((o) => o.value === selectedValues);
      return found ? found.label : null;
    }, [selectedValues, activeOptions, isMulti]);

    const renderedChips = React.useMemo(() => {
      if (!isMulti || !Array.isArray(selectedValues)) return null;

      return selectedValues.map((val) => {
        const found = activeOptions.find((o) => o.value === val);
        const displayLabel = found ? found.label : val;
        return (
          <span
            key={val}
            className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs font-medium text-zinc-200"
          >
            {displayLabel}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => removeValue(val, e)}
                className="rounded-full hover:bg-zinc-750 p-0.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        );
      });
    }, [selectedValues, activeOptions, isMulti, disabled, removeValue]);

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            id={labelId}
            htmlFor={selectId}
            className="text-sm font-medium text-zinc-300"
          >
            {label}
          </label>
        )}

        {/* Polite live region for async option loading announcements */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="select-live-region"
        >
          {isBusy ? loadingText : liveAnnouncement}
        </div>

        {/* Hidden native select for standard HTML forms & React Hook Form */}
        <select
          ref={hiddenSelectRef}
          name={name}
          id={`${selectId}-native`}
          tabIndex={-1}
          aria-hidden="true"
          multiple={isMulti}
          value={selectedValues}
          onBlur={onBlur}
          aria-invalid={!!error}
          aria-describedby={ariaDescribedBy || undefined}
          aria-required={props["aria-required"]}
          className="hidden"
          disabled={disabled}
          onChange={() => {}}
          {...props}
        >
          {effectivePlaceholder && <option value="">{effectivePlaceholder}</option>}
          {activeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <button
              id={selectId}
              type="button"
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-haspopup="listbox"
              aria-busy={isBusy ? "true" : "false"}
              aria-multiselectable={isMulti ? "true" : undefined}
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy ?? (!ariaLabel && labelId ? labelId : undefined)}
              disabled={disabled}
              aria-describedby={ariaDescribedBy || undefined}
              onFocus={() => {
                if (loadOptions && asyncError && !isLoadingAsync) {
                  void runLoadOptions(searchQuery);
                }
              }}
              className={cn(
                "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-sm text-foreground transition-all hover:border-zinc-700 hover:bg-zinc-900/60 focus:border-kora-500 focus:outline-none focus:ring-1 focus:ring-kora-500/50 disabled:cursor-not-allowed disabled:opacity-50",
                isOpen && "border-kora-500 ring-1 ring-kora-500/50",
                error && "border-destructive/50",
                className
              )}
            >
              <div className="flex flex-wrap gap-1 items-center max-w-[90%] text-left">
                {isMulti ? (
                  renderedChips?.length ? (
                    renderedChips
                  ) : (
                    <span className="text-zinc-500">{effectivePlaceholder}</span>
                  )
                ) : selectedLabel ? (
                  <span className="text-zinc-250 font-medium">{selectedLabel}</span>
                ) : (
                  <span className="text-zinc-500">{effectivePlaceholder}</span>
                )}
              </div>
              {isBusy ? (
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 text-zinc-500 animate-spin shrink-0"
                />
              ) : (
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 text-zinc-500 transition-transform duration-200",
                    isOpen && "rotate-185"
                  )}
                />
              )}
            </button>
          </Popover.Trigger>

          {asyncError && !isOpen && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 text-xs text-destructive"
            >
              <span>{asyncError}</span>
              <button
                type="button"
                onClick={() => void runLoadOptions(searchQuery)}
                className="underline font-medium hover:text-destructive/80"
              >
                {retryText}
              </button>
            </div>
          )}

          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              className={cn(
                "z-50 max-h-68 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100",
                "flex flex-col"
              )}
            >
              {/* Search input field */}
              {(isSearchable || loadOptions) && (
                <div className="flex items-center gap-2 border-b border-zinc-900 px-2 py-1.5 shrink-0">
                  <Search className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
                    disabled={disabled}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Scrollable list */}
              <div
                id={listboxId}
                role="listbox"
                aria-busy={isBusy ? "true" : "false"}
                aria-multiselectable={isMulti ? "true" : undefined}
                aria-label={ariaLabel || label || effectivePlaceholder}
                className="overflow-y-auto max-h-52 flex-1 p-1 space-y-0.5"
              >
                {isBusy ? (
                  <div className="flex items-center justify-center py-6 text-zinc-500 text-xs gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {loadingText}
                  </div>
                ) : asyncError ? (
                  <div
                    role="alert"
                    className="flex flex-col items-center justify-center gap-2 py-4 text-center text-xs text-destructive"
                  >
                    <span>{asyncError}</span>
                    <button
                      type="button"
                      onClick={() => void runLoadOptions(searchQuery)}
                      className="rounded border border-destructive/40 px-2 py-1 text-xs font-medium hover:bg-destructive/10"
                    >
                      {retryText}
                    </button>
                  </div>
                ) : loadOptions && filteredOptions.length === 0 ? (
                  <div className="py-4 text-center text-xs text-zinc-500">No results found</div>
                ) : !loadOptions && filteredOptions.length === 0 ? (
                  <div className="py-4 text-center text-xs text-zinc-500">No options match query</div>
                ) : (
                  filteredOptions.map((opt, index) => {
                    if ("options" in opt && Array.isArray(opt.options)) {
                      return (
                        <div
                          key={`group-${index}`}
                          role="group"
                          aria-label={opt.label}
                          className="space-y-0.5"
                        >
                          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-t border-zinc-900/40 first:border-t-0">
                            {opt.label}
                          </div>
                          {opt.options.map((subOpt) => (
                            <button
                              key={subOpt.value}
                              type="button"
                              role="option"
                              aria-selected={isSelected(subOpt.value)}
                              onClick={() => handleSelectValue(subOpt.value)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg pl-5 pr-2.5 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 transition-colors text-left",
                                isSelected(subOpt.value) && "bg-zinc-900/60 text-kora-400 hover:bg-zinc-900"
                              )}
                            >
                              <HighlightText text={subOpt.label} highlight={searchQuery} />
                              {isSelected(subOpt.value) && <Check className="h-4 w-4 text-kora-500 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={(opt as Option).value}
                        type="button"
                        role="option"
                        aria-selected={isSelected((opt as Option).value)}
                        onClick={() => handleSelectValue((opt as Option).value)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 transition-colors text-left",
                          isSelected((opt as Option).value) && "bg-zinc-900/60 text-kora-400 hover:bg-zinc-900"
                        )}
                      >
                        <HighlightText text={(opt as Option).label} highlight={searchQuery} />
                        {isSelected((opt as Option).value) && <Check className="h-4 w-4 text-kora-500 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
