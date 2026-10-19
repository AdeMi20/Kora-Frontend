/**
 * Opt-in nightly testnet E2E — mint, fund, repay against real contracts.
 *
 * Unlike the rest of the e2e/ suite (mock wallet, mock data), this spec
 * talks to the live Soroban testnet contracts using a funded keypair, the
 * same way scripts/seed-testnet.ts does. It is intentionally NOT part of
 * the default `npm run test:e2e` / CI `test.yml` run:
 *
 *   - It is skipped unless RUN_TESTNET_E2E=true is set.
 *   - It requires TESTNET_E2E_SECRET_KEY (a funded testnet account) and
 *     NEXT_PUBLIC_STELLAR_NETWORK=testnet.
 *
 * See .github/workflows/nightly-testnet-e2e.yml for the scheduled runner
 * that opts in and provides these secrets.
 *
 * A second, separately gated suite (tagged @freighter, Issue #1027) loads the
 * REAL Freighter extension, connects it through WalletConnectModal and has it
 * sign a canned testnet transaction that is never submitted. It is skipped
 * unless RUN_FREIGHTER_E2E=true, FREIGHTER_EXTENSION_PATH and
 * TESTNET_E2E_FREIGHTER_MNEMONIC are all present. Full setup and skip rules:
 * docs/testnet-nightly-e2e.md.
 */
import { test, expect } from "@playwright/test";
import {
  FREIGHTER_TEST_TIMEOUT_MS,
  FREIGHTER_TIMEOUTS,
  approveFreighterPopup,
  getFreighterSkipReason,
  launchWithFreighter,
  onboardFreighter,
  readFreighterConfig,
  resolveFreighterApiBundle,
  withTimeout,
} from "./helpers/freighter-extension";

const RUN_TESTNET_E2E = process.env.RUN_TESTNET_E2E === "true";
const SECRET_KEY = process.env.TESTNET_E2E_SECRET_KEY;

test.describe("Testnet — mint, fund, repay (real contracts)", () => {
  test.skip(
    !RUN_TESTNET_E2E,
    "Opt-in nightly-only suite. Set RUN_TESTNET_E2E=true to run against live testnet contracts."
  );

  test("mints, funds, and repays a real invoice on testnet", async () => {
    expect(
      SECRET_KEY,
      "TESTNET_E2E_SECRET_KEY must be set (funded testnet keypair) when RUN_TESTNET_E2E=true"
    ).toBeTruthy();

    const { env } = await import("@/lib/env");
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("testnet");

    const StellarSdk = await import("@stellar/stellar-sdk");
    const { fundTestnetAccount, submitTransaction, waitForTransaction } = await import(
      "@/lib/stellar/client"
    );
    const { invoiceContract, marketplaceContract, buildTestnetUsdcMintTx } = await import(
      "@/lib/stellar/contracts"
    );

    const owner = StellarSdk.Keypair.fromSecret(SECRET_KEY!);
    await fundTestnetAccount(owner.publicKey());

    const usdcMintXdr = await buildTestnetUsdcMintTx(owner.publicKey(), 1_000_000_000n);
    const signedUsdcMint = await signWithKeypair(StellarSdk, usdcMintXdr, owner);
    const usdcResult = await submitTransaction(signedUsdcMint);
    await waitForTransaction(usdcResult.hash);

    const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
    const mintXdr = await invoiceContract.mintInvoice(
      {
        ipfsCid: "QmNightlyTestnetE2EPlaceholder",
        amount: 1_000_000_000n,
        financingAmount: 900_000_000n,
        discountRate: 1000,
        dueDate,
      },
      owner.publicKey()
    );
    const signedMint = await signWithKeypair(StellarSdk, mintXdr, owner);
    const mintResult = await submitTransaction(signedMint);
    const mintConfirmation = await waitForTransaction(mintResult.hash);
    expect(mintConfirmation.status).toBe("SUCCESS");

    const onChainInvoice = await invoiceContract.getInvoice(
      /* tokenId */ 0n,
      owner.publicKey()
    );
    expect(onChainInvoice).toBeTruthy();

    const fundXdr = await marketplaceContract.fundInvoice(
      { tokenId: 0n, amount: 900_000_000n },
      owner.publicKey()
    );
    const signedFund = await signWithKeypair(StellarSdk, fundXdr, owner);
    const fundResult = await submitTransaction(signedFund);
    const fundConfirmation = await waitForTransaction(fundResult.hash);
    expect(fundConfirmation.status).toBe("SUCCESS");

    const repayXdr = await marketplaceContract.repayInvoice(
      { tokenId: 0n },
      owner.publicKey()
    );
    const signedRepay = await signWithKeypair(StellarSdk, repayXdr, owner);
    const repayResult = await submitTransaction(signedRepay);
    const repayConfirmation = await waitForTransaction(repayResult.hash);
    expect(repayConfirmation.status).toBe("SUCCESS");
  });
});

// ─── Real Freighter extension: connect + sign (Issue #1027) ──────────────────

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const TESTNET_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const CANNED_DATA_NAME = "kora-nightly-e2e";

test.describe("Testnet — real Freighter extension connect and sign @freighter", () => {
  const skipReason = getFreighterSkipReason();
  test.skip(skipReason !== null, skipReason ?? "");

  test("connects Freighter via the modal and signs a canned testnet transaction", async ({
    baseURL,
  }, testInfo) => {
    test.setTimeout(FREIGHTER_TEST_TIMEOUT_MS);
    const config = readFreighterConfig();

    const session = await test.step("launch Chromium with Freighter loaded", () =>
      launchWithFreighter(config, baseURL ?? "http://localhost:3000")
    );

    let tracing = false;
    let failed = false;
    try {
      // Onboarding types the mnemonic, so it runs before tracing starts —
      // the recovery phrase must never be captured in a trace artifact.
      await test.step("import testnet wallet into Freighter", () =>
        onboardFreighter(session, config.mnemonic)
      );

      await session.context.tracing.start({
        title: testInfo.title,
        screenshots: true,
        snapshots: true,
      });
      tracing = true;

      const page = await session.context.newPage();
      await page.addInitScript({ path: resolveFreighterApiBundle() });
      await page.goto("/");

      await test.step("connect Freighter through WalletConnectModal", async () => {
        await page
          .locator("header")
          .getByRole("button")
          .filter({ hasText: /connect wallet/i })
          .click();

        const connectButton = page
          .getByRole("dialog")
          .getByRole("button", { name: "Connect Freighter" });
        await expect(connectButton).toBeEnabled({ timeout: FREIGHTER_TIMEOUTS.connect });

        await approveFreighterPopup(
          session,
          () => connectButton.click(),
          /^(connect|share|allow|approve)$/i
        );

        await expect(
          page.locator("header").getByRole("button").filter({ hasText: /G[A-Z0-9]{3}/ })
        ).toBeVisible({ timeout: FREIGHTER_TIMEOUTS.connect });
      });

      const address = await test.step("read the connected Freighter address", () =>
        withTimeout(
          page.evaluate(async () => {
            const api = (window as unknown as { freighterApi: any }).freighterApi;
            const res = api.getAddress ? await api.getAddress() : await api.getPublicKey();
            return typeof res === "string" ? res : (res?.address as string);
          }),
          FREIGHTER_TIMEOUTS.connect,
          "Freighter getAddress"
        )
      );
      expect(address).toMatch(/^G[A-Z2-7]{55}$/);
      if (config.expectedPublicKey) {
        expect(address).toBe(config.expectedPublicKey);
      }

      const StellarSdk = await import("@stellar/stellar-sdk");
      const unsignedXdr = await test.step("build canned (never submitted) transaction", () =>
        buildCannedTransaction(StellarSdk, address)
      );

      const signedXdr = await test.step("sign with Freighter", () =>
        withTimeout(
          (async () => {
            let signPromise: Promise<string> | undefined;
            await approveFreighterPopup(
              session,
              async () => {
                signPromise = page.evaluate(
                  async ({ xdr, networkPassphrase, address }) => {
                    const api = (window as unknown as { freighterApi: any }).freighterApi;
                    const res = await api.signTransaction(xdr, {
                      networkPassphrase,
                      address,
                      accountToSign: address,
                      network: "TESTNET",
                    });
                    if (typeof res === "string") return res;
                    if (res?.error) throw new Error(String(res.error.message ?? res.error));
                    return res.signedTxXdr as string;
                  },
                  { xdr: unsignedXdr, networkPassphrase: TESTNET_PASSPHRASE, address }
                );
              },
              /^(sign|sign transaction|confirm|approve)$/i
            );
            return signPromise!;
          })(),
          FREIGHTER_TIMEOUTS.sign,
          "Freighter signTransaction"
        )
      );

      await test.step("verify the Freighter signature", async () => {
        const signed = StellarSdk.TransactionBuilder.fromXDR(
          signedXdr,
          TESTNET_PASSPHRASE
        ) as InstanceType<typeof StellarSdk.Transaction>;

        expect(signed.signatures).toHaveLength(1);
        expect(signed.operations[0]).toMatchObject({ type: "manageData", name: CANNED_DATA_NAME });
        const signer = StellarSdk.Keypair.fromPublicKey(address);
        expect(signer.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
      });
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      if (tracing) {
        if (failed) {
          const tracePath = testInfo.outputPath("freighter-trace.zip");
          await session.context.tracing.stop({ path: tracePath });
          await testInfo.attach("freighter-trace", {
            path: tracePath,
            contentType: "application/zip",
          });
        } else {
          await session.context.tracing.stop();
        }
      }
      await session.close();
    }
  });
});

/**
 * Build a low-value, read-only transaction for Freighter to sign: a single
 * manageData op on the connected account. It is only signed and verified
 * locally — never submitted — so it has no on-chain effect. Horizon/Friendbot
 * are used best-effort for a realistic sequence number; testnet downtime
 * falls back to an offline account so signing can still be exercised.
 */
async function buildCannedTransaction(
  StellarSdk: typeof import("@stellar/stellar-sdk"),
  address: string
): Promise<string> {
  let account: InstanceType<typeof StellarSdk.Account>;
  try {
    await withTimeout(
      fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`),
      10_000,
      "Friendbot"
    ).catch(() => undefined);
    const loaded = await withTimeout(
      new StellarSdk.Horizon.Server(TESTNET_HORIZON_URL).loadAccount(address),
      10_000,
      "Horizon loadAccount"
    );
    account = new StellarSdk.Account(address, loaded.sequenceNumber());
  } catch {
    account = new StellarSdk.Account(address, "0");
  }

  return new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.manageData({ name: CANNED_DATA_NAME, value: "sign-check" })
    )
    .setTimeout(300)
    .build()
    .toXDR();
}

async function signWithKeypair(
  StellarSdk: typeof import("@stellar/stellar-sdk"),
  unsignedXdr: string,
  keypair: InstanceType<typeof StellarSdk.Keypair>
): Promise<string> {
  const { env } = await import("@/lib/env");
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    unsignedXdr,
    env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE
  );
  tx.sign(keypair);
  return tx.toXDR();
}
