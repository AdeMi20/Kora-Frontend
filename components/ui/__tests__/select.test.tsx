import React from "react";
import { render as rtlRender, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { Select, type Option, type OptionGroup } from "../select";

function renderWithLocale(
  ui: React.ReactElement,
  locale: "en" | "ar" = "en",
  messages: Record<string, unknown> = en
) {
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Select — aria-busy and live region for async option loading (#963)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets aria-busy='true' on combobox trigger when loading prop is true and clears when false", () => {
    const options: Option[] = [
      { value: "ke", label: "Kenya" },
      { value: "ng", label: "Nigeria" },
    ];

    const { rerender } = renderWithLocale(
      <Select
        label="Jurisdiction"
        options={[]}
        loading={true}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Jurisdiction" });
    expect(trigger).toHaveAttribute("aria-busy", "true");

    const liveRegion = screen.getByTestId("select-live-region");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent(en.ui.select.loading);

    rerender(
      <Select
        label="Jurisdiction"
        options={options}
        loading={false}
      />
    );

    expect(trigger).toHaveAttribute("aria-busy", "false");
    expect(liveRegion).toHaveTextContent("2 options available");
  });

  it("announces busy during deferred loadOptions promise and clears after options resolve", async () => {
    const deferred = createDeferred<Option[]>();
    const loadOptions = vi.fn(() => deferred.promise);

    renderWithLocale(
      <Select
        label="Category"
        loadOptions={loadOptions}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Category" });
    const liveRegion = screen.getByTestId("select-live-region");

    // Busy while promise is pending
    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(liveRegion).toHaveTextContent(en.ui.select.loading);

    // Resolve deferred options
    await act(async () => {
      deferred.resolve([
        { value: "tech", label: "Technology" },
        { value: "agri", label: "Agriculture" },
      ]);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-busy", "false");
    });
    expect(liveRegion).toHaveTextContent("2 options available");
  });

  it("supports grouped async options and announces total flattened option count", async () => {
    const deferred = createDeferred<OptionGroup[]>();
    const loadOptions = vi.fn(() => deferred.promise);

    renderWithLocale(
      <Select
        label="Industry Category"
        loadOptions={loadOptions}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Industry Category" });
    expect(trigger).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      deferred.resolve([
        {
          label: "Primary",
          options: [
            { value: "agriculture", label: "Agriculture" },
            { value: "energy", label: "Energy" },
          ],
        },
        {
          label: "Secondary",
          options: [{ value: "manufacturing", label: "Manufacturing" }],
        },
      ]);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-busy", "false");
    });

    const liveRegion = screen.getByTestId("select-live-region");
    expect(liveRegion).toHaveTextContent("3 options available");
  });

  it("clears aria-busy and announces error when async loading fails with empty options", async () => {
    const deferred = createDeferred<Option[]>();
    const loadOptions = vi.fn(() => deferred.promise);

    renderWithLocale(
      <Select
        aria-label="Async filter"
        loadOptions={loadOptions}
        options={[]}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Async filter" });
    expect(trigger).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      deferred.reject(new Error("RPC timeout"));
      try {
        await deferred.promise;
      } catch {
        // expected rejection
      }
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-busy", "false");
    });

    const liveRegion = screen.getByTestId("select-live-region");
    expect(liveRegion).toHaveTextContent(en.ui.select.loadError);
    expect(screen.getByRole("alert")).toHaveTextContent(en.ui.select.loadError);
  });

  it("announces empty options when loading resolves with an empty list", async () => {
    const deferred = createDeferred<Option[]>();
    const loadOptions = vi.fn(() => deferred.promise);

    renderWithLocale(
      <Select
        label="Empty Select"
        loadOptions={loadOptions}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Empty Select" });
    expect(trigger).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      deferred.resolve([]);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-busy", "false");
    });

    const liveRegion = screen.getByTestId("select-live-region");
    expect(liveRegion).toHaveTextContent("No options available");
  });

  it("preserves multi-select busy semantics and aria-multiselectable", () => {
    const { rerender } = renderWithLocale(
      <Select
        label="Jurisdictions"
        isMulti={true}
        loading={true}
        options={[]}
        value={["KE"]}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Jurisdictions" });
    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(trigger).toHaveAttribute("aria-multiselectable", "true");

    rerender(
      <Select
        label="Jurisdictions"
        isMulti={true}
        loading={false}
        options={[
          { value: "KE", label: "Kenya" },
          { value: "NG", label: "Nigeria" },
        ]}
        value={["KE"]}
      />
    );

    expect(trigger).toHaveAttribute("aria-busy", "false");
    expect(trigger).toHaveAttribute("aria-multiselectable", "true");
  });

  it("handles rapid open/close while loading without losing busy state or throwing", async () => {
    const deferred = createDeferred<Option[]>();
    const loadOptions = vi.fn(() => deferred.promise);

    renderWithLocale(
      <Select
        label="Rapid Select"
        loadOptions={loadOptions}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Rapid Select" });
    expect(trigger).toHaveAttribute("aria-busy", "true");

    // Rapid open/close interactions while still loading
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-busy", "true");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-busy", "true");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      deferred.resolve([{ value: "1", label: "Option One" }]);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-busy", "false");
    });

    expect(screen.getByRole("option", { name: "Option One" })).toBeInTheDocument();
  });

  it("renders localized Arabic loading announcement from ui.select.loading", () => {
    renderWithLocale(
      <Select
        label="الولاية القضائية"
        loading={true}
        options={[]}
      />,
      "ar",
      ar
    );

    const liveRegion = screen.getByTestId("select-live-region");
    expect(liveRegion).toHaveTextContent(ar.ui.select.loading);
  });

  it("does not alter keyboard navigation tab order (hidden native select has tabIndex -1)", () => {
    const { container } = renderWithLocale(
      <div>
        <button type="button">Before</button>
        <Select
          label="Jurisdiction"
          loading={true}
          options={[{ value: "KE", label: "Kenya" }]}
        />
        <button type="button">After</button>
      </div>
    );

    const nativeSelect = container.querySelector("select");
    expect(nativeSelect).toHaveAttribute("tabindex", "-1");
    expect(nativeSelect).toHaveAttribute("aria-hidden", "true");

    const trigger = screen.getByRole("combobox", { name: "Jurisdiction" });
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });
});
