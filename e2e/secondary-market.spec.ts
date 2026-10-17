/**
 * e2e/secondary-market.spec.ts
 *
 * Browse-flow coverage for the secondary market page (Issue #675).
 *
 * /secondary renders from mock listings that are stable in CI, so the whole
 * flow is deterministic without any network stubbing: load the grid, narrow it
 * with a tenor filter, reset back to the full grid, and drive the same filters
 * through the mobile bottom sheet.
 *
 * Issue #899 adds failure-path coverage: the AcceptTransfer stub failure
 * banner and the acquire simulation-failure UI must both recover cleanly
 * without leaving a stuck modal behind.
 *
 * Issue #942 adds URL filter sync coverage: filters write their query keys,
 * survive reload and back/forward, and malformed params are sanitized. Those
 * tests assert on the URL and the filter controls only, never on listing
 * counts, so they do not depend on the mock listings.
 *
 * Run:
 *   npx playwright test e2e/secondary-market.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

/** Dismiss tour + changelog so neither overlays the page under test. */
async function suppressOverlays(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("kora-tour-done", "true");
    localStorage.setItem("kora-changelog-seen-version", "0.1.0");
  });
}

/**
 * Each position card carries exactly one acquire button — "Acquire Position"
 * with a wallet connected, "Connect Wallet to Acquire" without one.
 */
function positionCards(page: Page) {
  return page.getByRole("button", { name: /acquire position|connect wallet to acquire/i });
}

/**
 * Pick a value from one of the filter dropdowns.
 *
 * The Select renders a hidden native <select> for form libraries plus a Radix
 * popover for the actual UI, so the accessible label belongs to the hidden
 * element — the visible control has to be driven by its current label. Its
 * options are plain buttons inside the popover. The trigger is retried because
 * a click that lands before hydration is dropped.
 */
async function chooseFilter(page: Page, currentLabel: string, optionLabel: string) {
  const option = page
    .locator("[data-radix-popper-content-wrapper]")
    .getByRole("button", { name: optionLabel, exact: true });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await page.getByRole("button", { name: currentLabel, exact: true }).click();
    }
    await expect(option).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await option.click();
}

const SELLER_PLACEHOLDER = "Seller G-address...";

async function gotoSecondary(page: Page, search = "") {
  await suppressOverlays(page);
  // domcontentloaded rather than load: dev-server chunk requests can keep the
  // load event pending well past the point the page is interactive.
  await page.goto(`/secondary${search}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /secondary market/i })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Secondary market browse", () => {
  test("renders the mock position listings", async ({ page }) => {
    await gotoSecondary(page);

    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });
    expect(await positionCards(page).count()).toBeGreaterThan(0);
  });

  test("shows the page framing and P2P badge", async ({ page }) => {
    await gotoSecondary(page);

    await expect(page.getByText(/p2p transferable positions/i)).toBeVisible();
  });

  test("a tenor filter narrows the grid", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    const before = await positionCards(page).count();

    // 0–30 days is the narrowest bucket, so it cannot match every mock listing.
    await chooseFilter(page, "All Tenors", "0 - 30 days");

    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });

  test("resetting filters restores the full grid", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    const before = await positionCards(page).count();

    await chooseFilter(page, "All Tenors", "0 - 30 days");
    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBeLessThan(before);

    await page.getByRole("button", { name: /reset all filters/i }).click();

    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBe(before);
  });

  test("a filter matching nothing shows the empty state", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    // No mock seller matches this address.
    await page
      .getByPlaceholder(SELLER_PLACEHOLDER)
      .first()
      .fill("GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");

    await expect(page.getByText(/no transferable positions found/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("the empty state can clear the filters", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await positionCards(page).count();

    await page
      .getByPlaceholder(SELLER_PLACEHOLDER)
      .first()
      .fill("GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
    await expect(page.getByText(/no transferable positions found/i)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /clear all filters/i }).click();

    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBe(before);
  });

  test("filters survive a reload through the URL", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    await chooseFilter(page, "All Tenors", "0 - 30 days");
    await expect.poll(async () => page.url(), { timeout: 15_000 }).toContain("tenor=0-30");

    await page.reload();

    await expect(page.getByRole("button", { name: "0 - 30 days", exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});

/** Current query params as a plain object, for exact URL assertions. */
function searchParamsOf(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

/** The visible desktop Select trigger currently showing `label`. */
function filterTrigger(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

test.describe("Secondary market URL filter sync", () => {
  test("tenor and yield filters write their query keys", async ({ page }) => {
    await gotoSecondary(page);

    await chooseFilter(page, "All Tenors", "0 - 30 days");
    await chooseFilter(page, "Any Yield", "10%+ Yield");

    await expect
      .poll(() => searchParamsOf(page), { timeout: 15_000 })
      .toEqual({ tenor: "0-30", yield: "10" });
  });

  test("a reload keeps multiple filters applied", async ({ page }) => {
    await gotoSecondary(page, "?tenor=31-60&yield=5");
    await expect(filterTrigger(page, "31 - 60 days")).toBeVisible({ timeout: 10_000 });
    await expect(filterTrigger(page, "5%+ Yield")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(filterTrigger(page, "31 - 60 days")).toBeVisible({ timeout: 15_000 });
    await expect(filterTrigger(page, "5%+ Yield")).toBeVisible();
    expect(searchParamsOf(page)).toEqual({ tenor: "31-60", yield: "5" });
  });

  test("back and forward restore the previous filter set", async ({ page }) => {
    await gotoSecondary(page, "?tenor=0-30");
    await expect(filterTrigger(page, "0 - 30 days")).toBeVisible({ timeout: 10_000 });

    await gotoSecondary(page, "?yield=15");
    await expect(filterTrigger(page, "15%+ Yield")).toBeVisible({ timeout: 10_000 });

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(filterTrigger(page, "0 - 30 days")).toBeVisible({ timeout: 15_000 });
    await expect(filterTrigger(page, "Any Yield")).toBeVisible();
    expect(searchParamsOf(page)).toEqual({ tenor: "0-30" });

    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect(filterTrigger(page, "15%+ Yield")).toBeVisible({ timeout: 15_000 });
    await expect(filterTrigger(page, "All Tenors")).toBeVisible();
    expect(searchParamsOf(page)).toEqual({ yield: "15" });
  });

  test("malformed params are sanitized without crashing", async ({ page }) => {
    // Unknown tenor/yield values fall back to defaults; the BEL control
    // character is stripped from q.
    await gotoSecondary(page, "?tenor=bogus&yield=999&q=%07abc");

    await expect(filterTrigger(page, "All Tenors")).toBeVisible({ timeout: 10_000 });
    await expect(filterTrigger(page, "Any Yield")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /search secondary market listings/i })).toHaveValue(
      "abc",
    );
    await expect
      .poll(() => searchParamsOf(page), { timeout: 15_000 })
      .toEqual({ q: "abc" });
  });

  test("an empty result set keeps its params through a reload", async ({ page }) => {
    const seller = "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
    await gotoSecondary(page);

    // Re-fill until it sticks: input typed before hydration is discarded.
    const sellerInput = page.getByRole("textbox", { name: /filter by seller address/i }).first();
    await expect(async () => {
      await sellerInput.fill(seller);
      await expect(page.getByText(/no transferable positions found/i)).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 15_000 });
    await expect.poll(() => searchParamsOf(page), { timeout: 15_000 }).toEqual({ seller });

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByText(/no transferable positions found/i)).toBeVisible({
      timeout: 15_000,
    });
    expect(searchParamsOf(page)).toEqual({ seller });
  });
});

test.describe("Secondary market failure UX", () => {
  test("accepting a transfer surfaces the stub failure banner", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    // Open the accept flow from the first listing.
    await page.getByRole("button", { name: /accept transfer/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Confirm; the stub rejects with NOT_IMPLEMENTED, so the dialog must
    // surface a failure banner rather than silently closing.
    await dialog.getByRole("button", { name: /accept|confirm/i }).last().click();

    await expect(
      page.getByText(/not implemented|failed|unable to accept|something went wrong/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("an acquire simulation failure dismisses cleanly", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    await positionCards(page).first().click();

    // The acquire flow may open a modal; if it does, a simulated failure must
    // not leave it stuck open.
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      const confirm = dialog.getByRole("button", { name: /acquire|confirm|buy/i }).last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }

      // Either the modal closes on failure or it shows an inline error — but it
      // must never remain in a stuck, unresponsive state.
      await expect
        .poll(
          async () => {
            const stillOpen = await dialog.isVisible().catch(() => false);
            if (!stillOpen) return "closed";
            const hasError = await page
              .getByText(/not implemented|failed|unable to acquire|something went wrong/i)
              .first()
              .isVisible()
              .catch(() => false);
            return hasError ? "error" : "stuck";
          },
          { timeout: 10_000 },
        )
        .not.toBe("stuck");
    }

    // The page itself must remain usable after the failure.
    await expect(page.getByRole("heading", { name: /secondary market/i })).toBeVisible();
  });
});

test.describe("Secondary market on mobile", () => {
  // Viewport only — a full device descriptor would switch browser type inside
  // a describe, which Playwright rejects.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("filters are reached through the bottom sheet", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /filter positions/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });

  test("applying a tenor filter from the sheet narrows the grid", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await positionCards(page).count();

    await page.getByRole("button", { name: /filter positions/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    await chooseFilter(page, "All Tenors", "0 - 30 days");
    await page.getByRole("button", { name: /apply filters/i }).click();

    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });

  test("the sheet can reset filters", async ({ page }) => {
    await gotoSecondary(page);
    await expect(positionCards(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await positionCards(page).count();

    await page.getByRole("button", { name: /filter positions/i }).click();
    await chooseFilter(page, "All Tenors", "0 - 30 days");
    await page.getByRole("button", { name: /apply filters/i }).click();
    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBeLessThan(before);

    await page.getByRole("button", { name: /filter positions/i }).click();
    await page.getByRole("button", { name: /^reset$/i }).click();

    await expect
      .poll(async () => positionCards(page).count(), { timeout: 15_000 })
      .toBe(before);
  });
});
