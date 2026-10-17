import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Kora Protocol frontend.
 *
 * Runs against the local Next.js dev server (or a pre-built production server
 * in CI).  All tests use mock data — no live Stellar RPC calls are made.
 *
 * Projects:
 *  - chromium          : Full E2E flows (e2e/*.spec.ts)
 *  - components        : Browser-level component tests (e2e/components/*.spec.ts)
 *                        These cover interactions that are hard to test in jsdom,
 *                        such as drag-and-drop, native range inputs, and Radix
 *                        portalled popovers.
 *
 * CI usage:
 *   npx playwright test --reporter=html
 */
export default defineConfig({
  testDir: "./e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter: HTML for CI artifact, list for local dev */
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    /* Base URL so tests can use relative paths like page.goto('/') */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    /* Collect trace on first retry for debugging */
    trace: "on-first-retry",
    /* Screenshot on failure */
    screenshot: "only-on-failure",
    /* Video on first retry */
    video: "on-first-retry",
    /* Viewport */
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    /* ── Full E2E flows ─────────────────────────────────────────────────── */
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /(?<!components\/).*\.spec\.ts/,
    },

    /* ── Component-level browser tests ───────────────────────────────────
     *  Isolated to e2e/components/ so they never accidentally run as part
     *  of the full E2E suite (and vice-versa).
     * ─────────────────────────────────────────────────────────────────── */
    {
      name: "components",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /components\/.*\.spec\.ts/,
    },

    /* ── Mobile E2E (Issue #471) ──────────────────────────────────────────
     *  Runs only the mobile marketplace spec against a Pixel 5 viewport so
     *  touch events, bottom-sheet layout, and single-column grid are all
     *  exercised with the real mobile user-agent and touch capabilities.
     *
     *  Scoped to marketplace-mobile.spec.ts — add further mobile-focused
     *  spec files to the pattern as the suite grows.
     * ─────────────────────────────────────────────────────────────────── */
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        // Ensure touch is enabled (Pixel 5 device preset includes this, but
        // be explicit for clarity and future-proofing).
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /marketplace-mobile\.spec\.ts/,
    },
  ],

  /* Start Next.js before tests. Prefer production server in CI (after npm run build). */
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NEXT_PUBLIC_ENABLE_MOCK_DATA: process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA ?? "true",
      NEXT_PUBLIC_ENABLE_BATCH_ACTIONS:
        process.env.NEXT_PUBLIC_ENABLE_BATCH_ACTIONS ?? "true",
      NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR:
        process.env.NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR ?? "true",
      NEXT_PUBLIC_ENABLE_SECONDARY_MARKET:
        process.env.NEXT_PUBLIC_ENABLE_SECONDARY_MARKET ?? "true",
      NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet",
      NEXT_PUBLIC_STELLAR_RPC_URL:
        process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
      NEXT_PUBLIC_STELLAR_HORIZON_URL:
        process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
      NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
        process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
        "Test SDF Network ; September 2015",
      NEXT_PUBLIC_INVOICE_CONTRACT_ID:
        process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID ??
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID:
        process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ??
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      NEXT_PUBLIC_TOKEN_CONTRACT_ID:
        process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ??
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      NEXT_PUBLIC_IPFS_GATEWAY:
        process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs",
      PINATA_JWT: process.env.PINATA_JWT ?? "ci_dummy_pinata_jwt",
    },
  },
});
