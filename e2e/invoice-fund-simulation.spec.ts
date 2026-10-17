/**
 * E2E — Invoice Fund Simulation Preview
 *
 * Tests the `useTxSimulation` / `TxSimulationPreview` dialog on the
 * InvoiceDetailClient funding panel.
 *
 * ─── Wallet mock setup ────────────────────────────────────────────────────────
 * Real Stellar wallet extensions (Freighter, xBull …) are unavailable in
 * headless Chromium. We inject a lightweight Freighter window stub and seed the
 * Zustand `kora-wallet` localStorage key so the app rehydrates as connected
 * before the first render. The mock is kept deterministic:
 *
 *   - address: MOCK_ADDRESS (fixed G-key)
 *   - USDC balance: 50 000 (well above any fixture invoice's min/max)
 *   - `signTransaction`: echoes the XDR back, suffixed with `_signed`
 *   - `NEXT_PUBLIC_ENABLE_MOCK_DATA=true` in playwright.config.ts ensures the
 *     app never calls real Soroban RPCs; all tx preparation returns a
 *     deterministic `mock_<token>_fund` XDR that the mock signer accepts.
 *
 * Because `NEXT_PUBLIC_ENABLE_MOCK_DATA` is `true`, `useTransaction.execute()`
 * runs through the simulation path (it calls `onSimulationPreview` with a
 * synthetic preview object) and then awaits the user's proceed/cancel decision
 * from the dialog — no real on-chain submission occurs in CI.
 *
 * ─── Test stability ───────────────────────────────────────────────────────────
 * Each test navigates fresh, and the mock wallet state is injected via
 * `context.addInitScript` so it is available before the very first script
 * evaluation on the page. Tests are fully independent and produce stable
 * results across multiple runs.
 */

import { test, expect } from "@playwright/test";
import { injectWalletStubs } from "./helpers/mock-wallet";

// ── Fixture constants ─────────────────────────────────────────────────────────

/** Mock invoice used in the funding flow tests (partially funded, still open). */
const FIXTURE_INVOICE_ID = "inv_003";

/** The minimum investment for inv_003 in the mock data set. */
const VALID_FUND_AMOUNT = "10000";

/** Amount below the minimum investment — should surface a validation error. */
const BELOW_MIN_AMOUNT = "1";

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigate to the fixture invoice detail page with a wallet stub that has
 * plenty of USDC so balance-related gates do not interfere with simulation
 * tests.
 */
async function gotoFixtureInvoice(
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page,
  usdcBalance = "50000.00",
) {
  await injectWalletStubs(context, { usdcBalance });
  await page.addInitScript(() => {
    localStorage.setItem("kora-tour-done", "true");
    localStorage.setItem("kora-changelog-seen-version", "0.1.0");
  });
  await page.goto(`/marketplace/${FIXTURE_INVOICE_ID}`);
  // Wait for the fund panel to be hydrated
  await page.waitForSelector('[data-testid="fund-button"], button:has-text("Fund Invoice")', {
    timeout: 15_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Simulation preview opens
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Invoice Fund Simulation Preview — dialog opens", () => {
  test(
    "entering a valid amount and clicking Fund Invoice opens the simulation dialog",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      // Enter a valid fund amount
      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);

      // Click the fund button
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      // The TxSimulationPreview dialog should become visible
      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
    },
  );

  test("simulation dialog shows estimated fee section", async ({
    context,
    page,
  }) => {
    await gotoFixtureInvoice(context, page);

    await page
      .getByRole("spinbutton", { name: /Investment Amount/i })
      .fill(VALID_FUND_AMOUNT);
    await page.getByRole("button", { name: /Fund Invoice/i }).click();

    const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The dialog must contain the fee or resource section
    // (keys: "Estimated Fee", "Resource Usage", or the simulating spinner)
    const hasFee = dialog.getByText(/Estimated Fee/i);
    const hasResource = dialog.getByText(/Resource Usage/i);
    const hasSimulating = dialog.getByText(/Simulating transaction/i);

    await expect(hasFee.or(hasResource).or(hasSimulating)).toBeVisible();
  });

  test("simulation dialog contains Proceed & Sign and Cancel buttons", async ({
    context,
    page,
  }) => {
    await gotoFixtureInvoice(context, page);

    await page
      .getByRole("spinbutton", { name: /Investment Amount/i })
      .fill(VALID_FUND_AMOUNT);
    await page.getByRole("button", { name: /Fund Invoice/i }).click();

    const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(
      dialog.getByRole("button", { name: /Proceed & Sign/i }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Cancel/i }),
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Cancel without submitting (default CI mode)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Invoice Fund Simulation Preview — cancel without submit", () => {
  test(
    "clicking Cancel in the simulation dialog closes it without funding",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // Cancel — must NOT trigger on-chain submission
      await dialog.getByRole("button", { name: /Cancel/i }).click();

      // Dialog should be gone
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // Funding success banner must NOT appear
      await expect(
        page.getByText("Factoring escrow deposits funded!"),
      ).toBeHidden();
    },
  );

  test(
    "fund button is re-enabled after cancelling the simulation dialog",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog.getByRole("button", { name: /Cancel/i }).click();
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // The fund button must be interactive again for a retry
      await expect(
        page.getByRole("button", { name: /Fund Invoice/i }),
      ).toBeEnabled();
    },
  );

  test(
    "closing the simulation dialog via Escape also does not submit",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      await expect(
        page.getByText("Factoring escrow deposits funded!"),
      ).toBeHidden();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Amount validation prevents preview
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Invoice Fund Simulation Preview — edge cases", () => {
  test(
    "amount below minimum investment shows validation error and Fund button stays disabled",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(BELOW_MIN_AMOUNT);

      // Validation error must be visible
      await expect(
        page.getByText(/Minimum investment is/i),
      ).toBeVisible();

      // Fund Invoice button should be disabled
      await expect(
        page.getByRole("button", { name: /Fund Invoice/i }),
      ).toBeDisabled();
    },
  );

  test(
    "empty amount field keeps Fund Invoice button disabled",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      // Do not fill any amount — button must be disabled
      await expect(
        page.getByRole("button", { name: /Fund Invoice/i }),
      ).toBeDisabled();
    },
  );

  test(
    "insufficient balance shows inline error and Fund button is disabled",
    async ({ context, page }) => {
      // Inject wallet with very low USDC balance
      await gotoFixtureInvoice(context, page, "50.00");

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill("500");

      await expect(
        page.getByText(/Insufficient USDC balance/i),
      ).toBeVisible();

      await expect(
        page.getByRole("button", { name: /Fund Invoice/i }),
      ).toBeDisabled();
    },
  );

  test(
    "fully funded invoice hides the funding CTA entirely",
    async ({ context, page }) => {
      await injectWalletStubs(context, { usdcBalance: "50000.00" });
      await page.addInitScript(() => {
        localStorage.setItem("kora-tour-done", "true");
        localStorage.setItem("kora-changelog-seen-version", "0.1.0");
      });
      // inv_001 is fully funded in the mock dataset
      await page.goto("/marketplace/inv_001");
      await page.waitForSelector("text=Fund This Invoice", { timeout: 15_000 });

      // The fully-funded gate should show, not the amount input
      await expect(page.getByText(/Invoice Fully Funded|Fully Funded/i)).toBeVisible();
      await expect(
        page.getByRole("spinbutton", { name: /Investment Amount/i }),
      ).toBeHidden();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Optional mock fund success path
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Invoice Fund Simulation Preview — mock fund success path", () => {
  test(
    "clicking Proceed & Sign completes the mock funding and shows success banner",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // Proceed through the simulation — in mock mode this completes the
      // funding without any real on-chain submission.
      await dialog.getByRole("button", { name: /Proceed & Sign/i }).click();

      // Dialog must close after proceeding
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // Funding success message must appear
      await expect(
        page.getByText("Factoring escrow deposits funded!"),
      ).toBeVisible({ timeout: 10_000 });
    },
  );

  test(
    "funding progress updates optimistically after successful simulation",
    async ({ context, page }) => {
      await gotoFixtureInvoice(context, page);

      // Capture the pre-fund progress indicator
      const progressText = page.getByText(/\d+% of/i).first();
      const initialProgress = await progressText.textContent();

      await page
        .getByRole("spinbutton", { name: /Investment Amount/i })
        .fill(VALID_FUND_AMOUNT);
      await page.getByRole("button", { name: /Fund Invoice/i }).click();

      const dialog = page.getByRole("dialog", { name: /Transaction Preview/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: /Proceed & Sign/i }).click();
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // Optimistic update: progress should have increased
      await expect(
        page.getByText(/Factoring escrow deposits funded!/),
      ).toBeVisible({ timeout: 10_000 });

      const updatedProgress = await progressText.textContent();
      // The progress percentage string should have changed
      expect(updatedProgress).not.toBe(initialProgress);
    },
  );
});
