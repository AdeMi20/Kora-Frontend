/**
 * Playwright helpers for driving a REAL Freighter browser extension (Issue #1027).
 *
 * Unlike ./mock-wallet.ts (window stubs, no extension), these helpers launch
 * Chromium with the unpacked Freighter build loaded, import a testnet wallet
 * from a CI secret mnemonic, and approve Freighter's own popups — so the
 * nightly suite exercises extension-specific connect/sign behaviour.
 *
 * Required environment (see docs/testnet-nightly-e2e.md):
 *   RUN_FREIGHTER_E2E=true             opt-in flag (nightly workflow only)
 *   FREIGHTER_EXTENSION_PATH           unpacked extension dir containing manifest.json
 *   TESTNET_E2E_FREIGHTER_MNEMONIC     12/24-word testnet-only recovery phrase (secret)
 * Optional:
 *   TESTNET_E2E_FREIGHTER_PUBLIC_KEY   expected G-address derived from the mnemonic
 *   FREIGHTER_E2E_HEADLESS=true        use headless Chromium (needs a build with
 *                                      extension support); default is headed under xvfb
 *
 * The mnemonic is only ever typed into the extension's onboarding page, which
 * runs BEFORE tracing starts, so it never ends up in traces, screenshots or logs.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";

/** Per-step timeout budget (ms). The whole flow is bounded by FREIGHTER_TEST_TIMEOUT_MS. */
export const FREIGHTER_TIMEOUTS = {
  extensionBoot: 30_000,
  onboarding: 60_000,
  popup: 30_000,
  connect: 45_000,
  sign: 45_000,
} as const;

export const FREIGHTER_TEST_TIMEOUT_MS = 4 * 60_000;

export interface FreighterConfig {
  extensionPath: string;
  mnemonic: string;
  expectedPublicKey?: string;
  headless: boolean;
}

/**
 * Returns the reason the real-extension suite must be skipped, or null when
 * every prerequisite is present. Never includes secret values in the message.
 */
export function getFreighterSkipReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.RUN_FREIGHTER_E2E !== "true") {
    return "Opt-in nightly-only suite. Set RUN_FREIGHTER_E2E=true to run with the real Freighter extension.";
  }
  if (!env.TESTNET_E2E_FREIGHTER_MNEMONIC?.trim()) {
    return "TESTNET_E2E_FREIGHTER_MNEMONIC secret is not set — skipping real Freighter suite.";
  }
  const extensionPath = env.FREIGHTER_EXTENSION_PATH;
  if (!extensionPath) {
    return "FREIGHTER_EXTENSION_PATH is not set — skipping real Freighter suite.";
  }
  if (!existsSync(join(extensionPath, "manifest.json"))) {
    return `Freighter extension not found at FREIGHTER_EXTENSION_PATH (no manifest.json) — skipping.`;
  }
  return null;
}

export function readFreighterConfig(env: NodeJS.ProcessEnv = process.env): FreighterConfig {
  return {
    extensionPath: env.FREIGHTER_EXTENSION_PATH!,
    mnemonic: env.TESTNET_E2E_FREIGHTER_MNEMONIC!.trim(),
    expectedPublicKey: env.TESTNET_E2E_FREIGHTER_PUBLIC_KEY?.trim() || undefined,
    headless: env.FREIGHTER_E2E_HEADLESS === "true",
  };
}

export interface FreighterSession {
  context: BrowserContext;
  extensionId: string;
  extensionOrigin: string;
  close: () => Promise<void>;
}

/**
 * Launch a persistent Chromium context with Freighter loaded.
 * Extensions only load in persistent contexts, so the default `page` fixture
 * cannot be used for this suite.
 */
export async function launchWithFreighter(
  config: FreighterConfig,
  baseURL: string,
): Promise<FreighterSession> {
  const userDataDir = mkdtempSync(join(tmpdir(), "kora-freighter-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: config.headless,
    ...(config.headless ? { channel: "chromium" } : {}),
    baseURL,
    // freighter-api is injected as an init script; bypass the app CSP for it.
    bypassCSP: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${config.extensionPath}`,
      `--load-extension=${config.extensionPath}`,
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", {
      timeout: FREIGHTER_TIMEOUTS.extensionBoot,
    });
  }
  const extensionId = new URL(worker.url()).host;

  return {
    context,
    extensionId,
    extensionOrigin: `chrome-extension://${extensionId}`,
    close: async () => {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Import the testnet wallet into a fresh Freighter install and switch it to
 * Testnet. Uses a random throwaway password scoped to this browser profile.
 */
export async function onboardFreighter(
  session: FreighterSession,
  mnemonic: string,
): Promise<void> {
  const { context, extensionOrigin } = session;
  const password = `Kora-${randomBytes(12).toString("hex")}`;

  // Freighter opens its welcome tab on install; reuse it or open one.
  const page =
    context.pages().find((p) => p.url().startsWith(extensionOrigin)) ??
    (await context.newPage());
  await page.goto(`${extensionOrigin}/index.html#/`);

  const timeout = FREIGHTER_TIMEOUTS.onboarding;

  await page
    .getByRole("button", { name: /i already have a wallet|import wallet|import/i })
    .first()
    .click({ timeout });

  // Password step
  const passwordInputs = page.locator('input[type="password"]');
  await expect(passwordInputs.first()).toBeVisible({ timeout });
  const count = await passwordInputs.count();
  for (let i = 0; i < count; i++) {
    await passwordInputs.nth(i).fill(password);
  }
  const terms = page.getByRole("checkbox");
  if (await terms.count()) {
    await terms.first().check({ force: true });
  }
  await page.getByRole("button", { name: /confirm|continue|next/i }).first().click({ timeout });

  // Recovery phrase step: either one input per word or a single textarea.
  const words = mnemonic.split(/\s+/);
  const wordInputs = page.locator('input[type="text"], input[type="password"], textarea');
  await expect(wordInputs.first()).toBeVisible({ timeout });
  const wordInputCount = await wordInputs.count();
  if (wordInputCount >= words.length) {
    for (let i = 0; i < words.length; i++) {
      await wordInputs.nth(i).fill(words[i]!);
    }
  } else {
    await wordInputs.first().fill(mnemonic);
  }
  await page.getByRole("button", { name: /^import|confirm|continue/i }).first().click({ timeout });

  await expect(page.getByText(/all set|wallet (is )?ready|account imported/i).first()).toBeVisible({
    timeout,
  });

  await switchFreighterToTestnet(session, page);
  await page.close();
}

async function switchFreighterToTestnet(session: FreighterSession, page: Page): Promise<void> {
  const timeout = FREIGHTER_TIMEOUTS.onboarding;
  await page.goto(`${session.extensionOrigin}/index.html#/account`);

  const networkSelector = page
    .getByRole("button", { name: /main ?net|public network|test ?net|future ?net/i })
    .first();
  await networkSelector.click({ timeout });
  await page.getByText(/^test ?net$/i).first().click({ timeout });
  await expect(
    page.getByRole("button", { name: /test ?net/i }).first(),
  ).toBeVisible({ timeout });
}

/**
 * Run `trigger` and approve the Freighter popup it opens by clicking the first
 * button matching `approveLabel`.
 */
export async function approveFreighterPopup(
  session: FreighterSession,
  trigger: () => Promise<unknown>,
  approveLabel: RegExp,
): Promise<void> {
  const popupPromise = session.context.waitForEvent("page", {
    predicate: (p) => p.url().startsWith(session.extensionOrigin),
    timeout: FREIGHTER_TIMEOUTS.popup,
  });
  await trigger();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup
    .getByRole("button", { name: approveLabel })
    .first()
    .click({ timeout: FREIGHTER_TIMEOUTS.popup });
}

/**
 * Resolve the UMD build of @stellar/freighter-api (a dependency of
 * @creit.tech/stellar-wallets-kit) so it can be injected into the dapp page.
 */
export function resolveFreighterApiBundle(): string {
  const rootRequire = createRequire(join(process.cwd(), "package.json"));
  try {
    return rootRequire.resolve("@stellar/freighter-api");
  } catch {
    const kitRequire = createRequire(rootRequire.resolve("@creit.tech/stellar-wallets-kit"));
    return kitRequire.resolve("@stellar/freighter-api");
  }
}

/** Reject if `promise` does not settle within `ms` — keeps steps inside their budget. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
