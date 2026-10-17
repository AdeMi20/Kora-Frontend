/**
 * Canonical toast helpers — Issue #691.
 *
 * `hooks/` used to carry two `useToast` modules with incompatible shapes, and
 * every call site imported the extensionless path, so which one they got was
 * decided by resolution order rather than intent. These tests pin the surviving
 * API: the helper set, the argument order each call site relies on, and the
 * notification-preference gate.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast } from "sonner";

import { useToast } from "@/hooks/useToast";
import { useSettingsStore, DEFAULT_NOTIFICATION_PREFS } from "@/store/settingsStore";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(() => "success-id"),
    error: vi.fn(() => "error-id"),
    loading: vi.fn(() => "loading-id"),
    info: vi.fn(() => "info-id"),
    dismiss: vi.fn(),
  },
}));

// `stellar-tx-link` reaches the Zod-validated env module through `lib/security`;
// this suite has no reason to require real Stellar config.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

const mocked = toast as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** Render the first argument sonner was handed, so its content is assertable. */
function renderNode(node: unknown): string {
  const { container } = require("@testing-library/react").render(
    node as React.ReactElement
  );
  return container.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    useSettingsStore.setState({
      notifications: { ...DEFAULT_NOTIFICATION_PREFS },
    });
  });
});

describe("useToast — surface", () => {
  it("exposes exactly one set of helpers", () => {
    const { result } = renderHook(() => useToast());

    expect(Object.keys(result.current).sort()).toEqual([
      "dismiss",
      "error",
      "info",
      "loading",
      "success",
    ]);
  });

  it("returns functions for every helper", () => {
    const { result } = renderHook(() => useToast());

    for (const key of ["loading", "success", "error", "info", "dismiss"] as const) {
      expect(typeof result.current[key]).toBe("function");
    }
  });
});

describe("useToast — success", () => {
  it("delegates to sonner's success channel", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.success("Invoice funded");
    });

    expect(mocked.success).toHaveBeenCalledTimes(1);
    expect(mocked.error).not.toHaveBeenCalled();
  });

  it("renders the message", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("Invoice funded");
    });

    expect(renderNode(mocked.success.mock.calls[0][0])).toContain("Invoice funded");
  });

  it("renders the transaction hash when one is supplied", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("Claim submitted", "abc123def456");
    });

    // The tx link is the second positional argument every call site uses.
    expect(renderNode(mocked.success.mock.calls[0][0])).toContain("t:txLink");
  });

  it("honours a caller-supplied toast id so a loading toast is replaced", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("done", undefined, "tx-toast");
    });

    expect(mocked.success.mock.calls[0][1]).toMatchObject({ id: "tx-toast" });
  });

  it("returns the id it used when no toast is shown", () => {
    act(() => {
      useSettingsStore.setState({
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          invoiceFunded: false,
        },
      });
    });

    const { result } = renderHook(() => useToast());
    let id: unknown;
    act(() => {
      id = result.current.success("suppressed", undefined, "keep-me", "invoiceFunded");
    });

    // Callers thread this id into a later dismiss/replace, so it must come back
    // even when the preference suppressed the toast itself.
    expect(id).toBe("keep-me");
    expect(mocked.success).not.toHaveBeenCalled();
  });
});

describe("useToast — error", () => {
  it("delegates to sonner's error channel", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.error("Transaction failed");
    });

    expect(mocked.error).toHaveBeenCalledTimes(1);
    expect(mocked.success).not.toHaveBeenCalled();
  });

  it("renders the message and its description", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.error("Transaction failed", "Insufficient balance");
    });

    const text = renderNode(mocked.error.mock.calls[0][0]);
    expect(text).toContain("Transaction failed");
    expect(text).toContain("Insufficient balance");
  });

  it("offers a retry affordance only when a retry handler is given", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.error("Failed", "why", () => {});
    });
    expect(renderNode(mocked.error.mock.calls[0][0])).toContain("t:retry");

    vi.clearAllMocks();
    act(() => {
      result.current.error("Failed", "why");
    });
    expect(renderNode(mocked.error.mock.calls[0][0])).not.toContain("t:retry");
  });

  it("always offers dismiss", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.error("Failed");
    });

    expect(renderNode(mocked.error.mock.calls[0][0])).toContain("t:dismiss");
  });

  it("stays on screen until dismissed", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.error("Failed");
    });

    // An error the user has not seen must not auto-expire.
    expect(mocked.error.mock.calls[0][1]).toMatchObject({ duration: Infinity });
  });

  it("is announced assertively", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.error("Failed");
    });

    const { container } = require("@testing-library/react").render(
      mocked.error.mock.calls[0][0] as React.ReactElement
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("useToast — info", () => {
  it("delegates to sonner's info channel", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.info("INV-001 funding reached 50%.");
    });

    expect(mocked.info).toHaveBeenCalledTimes(1);
    expect(renderNode(mocked.info.mock.calls[0][0])).toContain(
      "INV-001 funding reached 50%."
    );
  });

  it("is announced politely rather than assertively", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.info("passive notice");
    });

    const { container } = require("@testing-library/react").render(
      mocked.info.mock.calls[0][0] as React.ReactElement
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe("useToast — notification preferences", () => {
  it("shows a toast when its preference is on", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("funded", undefined, undefined, "invoiceFunded");
    });

    expect(mocked.success).toHaveBeenCalledTimes(1);
  });

  it("suppresses a toast whose preference is off", () => {
    act(() => {
      useSettingsStore.setState({
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          yieldAvailable: false,
        },
      });
    });

    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("claimed", undefined, undefined, "yieldAvailable");
      result.current.error("claim failed", undefined, undefined, undefined, "yieldAvailable");
      result.current.loading("claiming", "id", "yieldAvailable");
    });

    expect(mocked.success).not.toHaveBeenCalled();
    expect(mocked.error).not.toHaveBeenCalled();
    expect(mocked.loading).not.toHaveBeenCalled();
  });

  it("does not gate a toast that names no preference", () => {
    act(() => {
      useSettingsStore.setState({
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          txConfirmed: false,
          invoiceFunded: false,
          maturityReminder: false,
          yieldAvailable: false,
        },
      });
    });

    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success("untyped");
      result.current.error("untyped");
    });

    expect(mocked.success).toHaveBeenCalledTimes(1);
    expect(mocked.error).toHaveBeenCalledTimes(1);
  });
});

describe("useToast — dismiss", () => {
  it("forwards the id to sonner", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.dismiss("tx-toast");
    });

    expect(mocked.dismiss).toHaveBeenCalledWith("tx-toast");
  });
});
