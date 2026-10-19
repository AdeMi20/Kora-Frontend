/**
 * Horizon health toast — Issue #1007.
 *
 * Renders the real NetworkStatusIndicator against a mocked `useNetworkStatus`
 * and drives Horizon through status transitions, asserting the toast fires on
 * entry into degraded/down, is throttled per severity, and is dismissed on
 * recovery.
 */

import { render } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { NetworkStatus } from "@/hooks/useNetworkStatus";

const toastError = vi.fn();
const toastDismiss = vi.fn();
const refresh = vi.fn();

let horizonStatus: NetworkStatus = "operational";
let isOnline = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    loading: vi.fn(),
    success: vi.fn(),
    error: toastError,
    info: vi.fn(),
    dismiss: toastDismiss,
  }),
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({
    health: {
      overall: horizonStatus,
      soroban: { status: "operational", responseTime: 120, lastChecked: new Date() },
      horizon: { status: horizonStatus, responseTime: 80, lastChecked: new Date() },
      network: "testnet",
    },
    isOnline,
    refresh,
  }),
}));

vi.mock("@/lib/xdrDraftQueue", () => ({
  listQueuedXdrDrafts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/queryPersistence", () => ({
  getLatestMarketplaceDataUpdatedAt: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/layout/StaleDataBadge", () => ({
  StaleDataBadge: () => null,
}));

import { NetworkStatusIndicator } from "../NetworkStatusIndicator";
import {
  HORIZON_HEALTH_TOAST_ID,
  resetHorizonHealthToastThrottle,
} from "@/hooks/useHorizonHealthToast";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Harness() {
  return (
    <QueryClientProvider client={qc}>
      <NetworkStatusIndicator />
    </QueryClientProvider>
  );
}

function setStatus(rerender: (ui: React.ReactElement) => void, next: NetworkStatus) {
  horizonStatus = next;
  rerender(<Harness />);
}

describe("NetworkStatusIndicator — Horizon health toast", () => {
  beforeEach(() => {
    horizonStatus = "operational";
    isOnline = true;
    toastError.mockClear();
    toastDismiss.mockClear();
    resetHorizonHealthToastThrottle();
  });

  it("does not toast while Horizon is operational", () => {
    render(<Harness />);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("fires a localized toast when Horizon becomes degraded", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "degraded");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "t:horizonDegradedToast",
      "t:horizonToastHint",
      expect.any(Function),
      HORIZON_HEALTH_TOAST_ID,
    );
  });

  it("uses the down copy when Horizon goes down", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "down");

    expect(toastError).toHaveBeenCalledWith(
      "t:horizonDownToast",
      "t:horizonToastHint",
      expect.any(Function),
      HORIZON_HEALTH_TOAST_ID,
    );
  });

  it("retry action re-runs the health check", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "degraded");

    const onRetry = toastError.mock.calls[0][2] as () => void;
    onRetry();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the toast on subsequent polls with the same status", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "degraded");
    setStatus(rerender, "degraded");
    setStatus(rerender, "degraded");

    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("throttles flapping between operational and degraded to one toast per session", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "degraded");
    setStatus(rerender, "operational");
    setStatus(rerender, "degraded");
    setStatus(rerender, "operational");
    setStatus(rerender, "degraded");

    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("throttles per severity — escalating to down still notifies once", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "degraded");
    setStatus(rerender, "down");
    setStatus(rerender, "degraded");
    setStatus(rerender, "down");

    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError.mock.calls[0][0]).toBe("t:horizonDegradedToast");
    expect(toastError.mock.calls[1][0]).toBe("t:horizonDownToast");
  });

  it("dismisses the toast when Horizon recovers", () => {
    const { rerender } = render(<Harness />);
    setStatus(rerender, "down");
    setStatus(rerender, "operational");

    expect(toastDismiss).toHaveBeenCalledWith(HORIZON_HEALTH_TOAST_ID);
  });

  it("does not toast while the browser is offline", () => {
    isOnline = false;
    const { rerender } = render(<Harness />);
    setStatus(rerender, "down");

    expect(toastError).not.toHaveBeenCalled();
  });
});
