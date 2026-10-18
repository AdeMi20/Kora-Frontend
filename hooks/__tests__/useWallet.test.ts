import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { probeWalletProviderHealth } from "../useWallet";

const originalEnv = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
const originalWindow = globalThis.window;

beforeEach(() => {
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE =
    "Public Global Stellar Network ; September 2015";
});
afterEach(() => {
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = originalEnv;
  globalThis.window = originalWindow;
});

describe("probeWalletProviderHealth (Issue #927)", () => {
  it("reports albedo as installed without needing a window provider", async () => {
    delete (globalThis as Window & { albedo?: unknown }).albedo;
    const result = await probeWalletProviderHealth("albedo");
    expect(result.installed).toBe(true);
    expect(["ready", "unsupported_network", "locked", "error"]).toContain(result.state);
  });

  it("reports freighter as missing when window.freighter is absent", async () => {
    (globalThis as Window & { freighter?: unknown }).freighter = undefined;
    const result = await probeWalletProviderHealth("freighter");
    expect(result.installed).toBe(false);
    expect(result.state).toBe("missing");
  });

  it("reports xbull as missing when xBullSDK is absent", async () => {
    (globalThis as Window & { xBullSDK?: unknown }).xBullSDK = undefined;
    const result = await probeWalletProviderHealth("xbull");
    expect(result.installed).toBe(false);
    expect(result.state).toBe("missing");
  });

  it("reports lobstr as missing when window.lobstr is absent", async () => {
    (globalThis as Window & { lobstr?: unknown }).lobstr = undefined;
    const result = await probeWalletProviderHealth("lobstr");
    expect(result.installed).toBe(false);
    expect(result.state).toBe("missing");
  });
});
