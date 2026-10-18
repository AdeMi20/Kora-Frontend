import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useDebounce from "../useDebounce";

describe("useDebounce (Issue #928)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the initial value", () => {
    const { result } = renderHook(() => useDebounce("a", 100));
    expect(result.current).toBe("a");
  });

  it("updates to the new value after the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("b");
  });

  it("cancels the pending update on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    unmount();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("a");
  });
});
