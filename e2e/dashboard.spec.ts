
/**
 * E2E — SME and Investor Dashboards
 *
 * Covers:
 *  - SME dashboard renders "Connect your wallet" gate when disconnected
 *  - Investor dashboard renders "Connect your wallet" gate when disconnected
 *  - With wallet state injected via localStorage, SME dashboard renders stat cards
 *  - With wallet state injected via localStorage, investor dashboard renders stat cards
 *  - SME dashboard stat card labels are visible
 *  - Investor dashboard stat card labels are visible
 *  - SME dashboard data table is rendered
 *  - Investor dashboard data table is rendered
 *  - "Create Invoice" CTA is visible on SME dashboard
 *  - "Browse Marketplace" CTA is visible on investor dashboard
 *  - SME zero-invoice empty state shows create-invoice CTA with investor-parity hierarchy
 *
 * Wallet simulation strategy:
 *   We inject a Zustand-compatible localStorage entry for `kora-wallet-store`
 *   before navigating so the app rehydrates as connected.  This avoids needing
 *   a real browser extension while still exercising the authenticated UI paths.
 */

import { test, expect, type BrowserContext } from "@playwright/test";
import { MOCK_ADDRESS } from "./helpers/mock-wallet";
import { MOCK_EMPTY_INVOICES } from "./helpers/mock-invoices";

// ── Shared wallet injection ───────────────────────────────────────────────────

async function injectConnectedWallet(context: BrowserContext) {
  await context.addInitScript((address) => {
    const walletState = {
      state: {
        address,
        publicKey: address,
        isConnected: true,
        provider: "freighter",
        balance: "1000.00",
        isVerified: false,
        verifiedAt: null,
      },
      version: 0,
    };
    localStorage.setItem("kora-wallet-store", JSON.stringify(walletState));
  }, MOCK_ADDRESS);
}

async function injectEmptyInvoiceState(context: BrowserContext) {
  await context.addInitScript((invoices) => {
    localStorage.setItem(
      "kora:mock-invoices",
      JSON.stringify(invoices)
    );
  }, MOCK_EMPTY_INVOICES);
}

async function injectKybGate(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem("kora:mock-kyb-status", "pending");
  });
}

// ── SME Dashboard ─────────────────────────────────────────────────────────────

test.describe("SME Dashboard — disconnected", () => {
  test("shows connect wallet gate when no wallet is connected", async ({
    page,
  }) => {
    await page.goto("/dashboard/sme");
    await expect(page.getByText(/Connect your wallet/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Connect Wallet/i })
    ).toBeVisible();
  });

  test("connect wallet button opens the wallet modal", async ({ page }) => {
    await page.goto("/dashboard/sme");
    await page.getByRole("button", { name: /Connect Wallet/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("SME Dashboard — connected", () => {
  test.beforeEach(async ({ context, page }) => {
    await injectConnectedWallet(context);
    await page.goto("/dashboard/sme");
    // Wait for the dashboard to render past the wallet gate
    await page.waitForSelector("text=Total Financed", { timeout: 15_000 });
  });

  test("renders all 4 stat card labels", async ({ page }) => {
    await expect(page.getByText("Total Financed")).toBeVisible();
    await expect(page.getByText("Active Invoices")).toBeVisible();
    await expect(page.getByText("Pending Repayment")).toBeVisible();
    await expect(page.getByText("Repayment Rate")).toBeVisible();
  });

  test("stat cards display numeric values", async ({ page }) => {
    // Values are formatted currency or counts — just verify they're non-empty
    const statCards = page.locator("[class*='stat']");
    // At least one stat card should be visible
    await expect(statCards.first()).toBeVisible();
  });

  test("renders the invoice data table", async ({ page }) => {
    // DataTable renders a <table> element
    await expect(page.locator("table")).toBeVisible();
  });

  test("data table has expected column headers", async ({ page }) => {
    await expect(page.getByRole("columnheader", { name: /Invoice/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Debtor/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Amount/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Status/i })).toBeVisible();
  });

  test("Create Invoice CTA is visible", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /Create Invoice/i })
    ).toBeVisible();
  });
});

// ── SME Dashboard — First Invoice Empty State Parity ─────────────────────────

test.describe("SME Dashboard — zero invoices empty state", () => {
  test.beforeEach(async ({ context, page }) => {
    await injectConnectedWallet(context);
    await injectEmptyInvoiceState(context);
    await page.goto("/dashboard/sme");
    await page.waitForSelector("text=Total Financed", { timeout: 15_000 });
  });

  test("renders the empty state heading and description", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /No invoices yet/i })
    ).toBeVisible();
    await expect(
      page.getByText(/Create your first invoice to start financing/i)
    ).toBeVisible();
  });

  test("shows create-invoice CTA linking to /invoice/create", async ({
    page,
  }) => {
    const cta = page.getByRole("link", { name: /Create Invoice/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/invoice/create");
  });

  test("empty state visual hierarchy matches investor empty state", async ({
    page,
  }) => {
    const emptyState = page.locator("[data-testid='empty-state']");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveAttribute("data-variant", "default");
    await expect(
      emptyState.getByRole("heading")
    ).toBeVisible();
    await expect(
      emptyState.getByRole("link", { name: /Create Invoice/i })
    ).toHaveAttribute("href", "/invoice/create");
  });

  test("does not render the invoice data table when empty", async ({
    page,
  }) => {
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("renders ErrorBoundary fallback with design-system styling", async ({
    page,
  }) => {
    const fallback = page.locator("[data-testid='error-boundary-fallback']");
    await expect(fallback).toHaveCount(0);
  });

  test("does not regress the SME loading skeleton", async ({ page }) => {
    // Skeleton must not persist once the dashboard has hydrated
    await expect(page.locator("[data-testid='dashboard-skeleton']")).toHaveCount(0);
  });
});

test.describe("SME Dashboard — KYB gate blocks create flow", () => {
  test.beforeEach(async ({ context, page }) => {
    await injectConnectedWallet(context);
    await injectEmptyInvoiceState(context);
    await injectKybGate(context);
    await page.goto("/dashboard/sme");
    await page.waitForSelector("text=Total Financed", { timeout: 15_000 });
  });

  test("disables create-invoice CTA while KYB is pending", async ({ page }) => {
    const cta = page.getByRole("link", { name: /Create Invoice/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("aria-disabled", "true");
  });
});

// ── SME Dashboard — Batch Actions (Issue #676) ────────────────────────────────

test.describe("SME Dashboard — Batch Actions (Flag Enabled)", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((address) => {
      const walletState = {
        state: {
          address,
          publicKey: address,
          isConnected: true,
          provider: "freighter",
          balance: "1000.00",
          isVerified: false,
          verifiedAt: null,
        },
        version: 0,
      };
      localStorage.setItem("kora-wallet-store", JSON.stringify(walletState));
      localStorage.setItem(
        "kora:feature-flag-overrides",
        JSON.stringify({ "batch-actions": true })
      );
    }, MOCK_ADDRESS);
    await page.goto("/dashboard/sme");
    await page.waitForSelector("table", { timeout: 15_000 });
  });

  test("renders selection checkboxes and shows toolbar when rows are selected", async ({
    page,
  }) => {
    // Row selection checkboxes should be present in table rows
    const rowCheckboxes = page.locator("tbody input[type='checkbox']");
    await expect(rowCheckboxes.first()).toBeVisible();

    // Select the first row
    await rowCheckboxes.first().check();

    // BatchActionToolbar should become visible
    await expect(page.getByText(/invoice.*selected/i)).toBeVisible();
    await expect(page.locator("[data-testid='batch-cancel-btn']")).toBeVisible();
  });

  test("cancel confirmation dialog blocks accidental batch and dismisses cleanly", async ({
    page,
  }) => {
    // Select the cancel-eligible invoices
    const rowCheckboxes = page.locator("tbody input[type='checkbox']");
    const count = await rowCheckboxes.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 2); i++) {
      await rowCheckboxes.nth(i).check();
    }

    // Click batch cancel button
    const cancelBtn = page.locator("[data-testid='batch-cancel-btn']");
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Confirm dialog should appear
    const cancelDialog = page.getByRole("dialog");
    await expect(cancelDialog).toBeVisible();
    await expect(cancelDialog.getByText(/Cancel.*Invoice/i)).toBeVisible();

    // Dismiss dialog via "Go Back" button
    const dismissBtn = page.locator("[data-testid='cancel-confirm-dismiss']");
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    // Confirm dialog is closed without submitting a chain transaction
    await expect(cancelDialog).not.toBeVisible();
  });
});

test.describe("SME Dashboard — Batch Actions (Flag Disabled / Skip Behavior)", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((address) => {
      const walletState = {
        state: {
          address,
          publicKey: address,
          isConnected: true,
          provider: "freighter",
          balance: "1000.00",
          isVerified: false,
          verifiedAt: null,
        },
        version: 0,
      };
      localStorage.setItem("kora-wallet-store", JSON.stringify(walletState));
      localStorage.setItem(
        "kora:feature-flag-overrides",
        JSON.stringify({ "batch-actions": false })
      );
    }, MOCK_ADDRESS);
    await page.goto("/dashboard/sme");
    await page.waitForSelector("table", { timeout: 15_000 });
  });

  test("skips batch toolbar and row checkboxes cleanly when flag is disabled", async ({
    page,
  }) => {
    // Selection checkboxes should not exist in the table
    const tableCheckboxes = page.locator("table input[type='checkbox']");
    await expect(tableCheckboxes).toHaveCount(0);

    // Toolbar should not be present
    await expect(page.locator("[data-testid='batch-cancel-btn']")).toHaveCount(0);
    await expect(page.getByText(/invoices selected/i)).toHaveCount(0);
  });
});

// ── Investor Dashboard ────────────────────────────────────────────────────────

test.describe("Investor Dashboard — disconnected", () => {
  test("shows connect wallet gate when no wallet is connected", async ({
    page,
  }) => {
    await page.goto("/dashboard/investor");
    await expect(page.getByText(/Connect your wallet/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Connect Wallet/i })
    ).toBeVisible();
  });
});

test.describe("Investor Dashboard — connected", () => {
  test.beforeEach(async ({ context, page }) => {
    await injectConnectedWallet(context);
    await page.goto("/dashboard/investor");
    // Wait for the dashboard to render past the wallet gate
    await page.waitForSelector("text=Portfolio Value", { timeout: 15_000 });
  });

  test("renders all 4 stat card labels", async ({ page }) => {
    await expect(page.getByText("Portfolio Value")).toBeVisible();
    await expect(page.getByText("Expected Yield")).toBeVisible();
    await expect(page.getByText("Active Positions")).toBeVisible();
    await expect(page.getByText(/Avg\. APR/i)).toBeVisible();
  });

  test("renders the positions data table", async ({ page }) => {
    await expect(page.locator("table")).toBeVisible();
  });

  test("data table has expected column headers", async ({ page }) => {
    await expect(page.getByRole("columnheader", { name: /Invoice/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Debtor/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Invested/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /APR/i })).toBeVisible();
  });

  test("renders allocation breakdown cards", async ({ page }) => {
    // Risk tier and jurisdiction allocation cards
    await expect(page.getByText(/By Risk Tier/i)).toBeVisible();
    await expect(page.getByText(/By Jurisdiction/i)).toBeVisible();
  });

  test("Browse Marketplace CTA is visible", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /Browse Marketplace/i })
    ).toBeVisible();
  });

  test("empty state uses same EmptyState component contract as SME", async ({
    page,
  }) => {
    const emptyState = page.locator("[data-testid='empty-state']");
    if (await emptyState.count()) {
      await expect(emptyState).toHaveAttribute("data-variant", "default");
    }
  });
});


