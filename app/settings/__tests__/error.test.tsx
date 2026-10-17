/**
 * app/settings/error.tsx — recoverable settings failure UI (#933).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SettingsError from "@/app/settings/error";
import en from "@/messages/en.json";

const reportClientError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    reportClientError: (...args: unknown[]) => reportClientError(...args),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Stand-in for the Next.js segment boundary: catches the child's error,
 * renders `SettingsError`, and `reset()` clears it so the child re-renders.
 */
class SegmentBoundary extends React.Component<
  { children: React.ReactNode },
  { error: (Error & { digest?: string }) | null }
> {
  state = { error: null as (Error & { digest?: string }) | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <SettingsError error={this.state.error} reset={() => this.setState({ error: null })} />
      );
    }
    return this.props.children;
  }
}

let shouldThrow = true;
function FlakySettings() {
  if (shouldThrow) {
    throw Object.assign(new Error("settings store exploded"), { digest: "dg-933" });
  }
  return <h1>Settings page</h1>;
}

function renderSegment() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(queryClient, "refetchQueries").mockResolvedValue(undefined);
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={en}>
        <SegmentBoundary>
          <FlakySettings />
        </SegmentBoundary>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  shouldThrow = true;
  reportClientError.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SettingsError", () => {
  it("shows settings-specific copy under a focused heading", () => {
    renderSegment();

    const heading = screen.getByRole("heading", { level: 1, name: en.settings.error.title });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(en.settings.error.description);
  });

  it("does not expose the error message outside development", () => {
    renderSegment();
    expect(screen.queryByText("settings store exploded")).not.toBeInTheDocument();
  });

  it("logs the digest under the settings boundary for support", () => {
    renderSegment();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "settings store exploded" }),
      expect.objectContaining({ boundary: "SettingsError", digest: "dg-933" })
    );
  });

  it("links home as the secondary recovery path", () => {
    renderSegment();
    expect(screen.getByRole("link", { name: en.error.goHome })).toHaveAttribute("href", "/");
  });

  it("reset() clears the error and re-renders the settings segment", async () => {
    const user = userEvent.setup();
    renderSegment();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: new RegExp(en.error.tryAgain, "i") }));

    expect(screen.getByRole("heading", { name: "Settings page" })).toBeInTheDocument();
    expect(screen.queryByText(en.settings.error.title)).not.toBeInTheDocument();
  });
});
