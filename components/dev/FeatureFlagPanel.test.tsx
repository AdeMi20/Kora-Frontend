import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagPanel } from "./FeatureFlagPanel";

const STORAGE_KEY = "kora:feature-flag-overrides";

describe("FeatureFlagPanel", () => {
  const originalDevtoolsEnv = process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS = "true";
    window.localStorage.clear();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS = originalDevtoolsEnv;
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  function renderPanel() {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <FeatureFlagPanel />
      </QueryClientProvider>,
    );

    return { invalidateQueries };
  }

  it("renders the development feature flag panel", () => {
    renderPanel();

    expect(
      screen.getByRole("region", { name: /feature flag devtools/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Feature Flags")).toBeInTheDocument();
  });

  it("persists overrides when a flag is toggled", async () => {
    const user = userEvent.setup();
    renderPanel();

    const comparisonToggle = screen.getByRole("checkbox", {
      name: /toggle comparison/i,
    });

    expect(comparisonToggle).not.toBeChecked();
    await user.click(comparisonToggle);

    expect(comparisonToggle).toBeChecked();
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
      '"comparison":true',
    );
    expect(screen.getAllByText("override")[0]).toBeInTheDocument();
  });

  it("invalidates invoice queries when mock-data is toggled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const user = userEvent.setup();
    const { invalidateQueries } = renderPanel();

    await user.click(
      screen.getByRole("checkbox", { name: /toggle mock-data/i }),
    );

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["invoices"],
    });
  });

  it("resets all overrides", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole("checkbox", { name: /toggle batch-actions/i }),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
      '"batch-actions":true',
    );

    await user.click(
      screen.getByRole("button", { name: /reset feature flag overrides/i }),
    );

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  describe("restricted overrides outside development (Issue #1025)", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "test");
    });

    it.each(["mock-data", "secondary-market"])(
      "disables the %s toggle and explains why",
      (flag) => {
        renderPanel();

        const toggle = screen.getByRole("checkbox", {
          name: new RegExp(`toggle ${flag}`, "i"),
        });
        expect(toggle).toBeDisabled();
        expect(toggle).toHaveAccessibleDescription(
          /disabled outside local development/i,
        );
      },
    );

    it("does not persist an override when a locked toggle is clicked", async () => {
      const user = userEvent.setup();
      const { invalidateQueries } = renderPanel();

      await user.click(
        screen.getByRole("checkbox", { name: /toggle mock-data/i }),
      );

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(invalidateQueries).not.toHaveBeenCalled();
    });

    it("keeps non-restricted flags toggleable", async () => {
      const user = userEvent.setup();
      renderPanel();

      const toggle = screen.getByRole("checkbox", { name: /toggle comparison/i });
      expect(toggle).toBeEnabled();
      await user.click(toggle);
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
        '"comparison":true',
      );
    });

    it("leaves restricted toggles enabled in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      renderPanel();

      expect(
        screen.getByRole("checkbox", { name: /toggle mock-data/i }),
      ).toBeEnabled();
      expect(
        screen.getByRole("checkbox", { name: /toggle secondary-market/i }),
      ).toBeEnabled();
    });
  });
});
