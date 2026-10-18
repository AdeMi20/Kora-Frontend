import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useThrottle from "../useThrottle";

describe("useThrottle (Issue #928)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the initial value", () => {
    const { result } = renderHook(() => useThrottle("a", 100));
    expect(result.current).toBe("a");
  });

  it("updates immediately when the interval has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });

  it("throttles rapid value churn to at most once per interval", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    rerender({ value: "c" });
    expect(result.current).toBe("c");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe("c");
  });

  it("clears the trailing timer on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useThrottle(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }).not.toThrow();
  });
});
