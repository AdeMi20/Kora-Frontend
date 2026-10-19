# Testnet Nightly E2E

`e2e/testnet-nightly.spec.ts` holds the only Playwright suites that talk to
the live Stellar testnet. Everything else in `e2e/` uses mock data and the
window stubs in `e2e/helpers/mock-wallet.ts`. Both nightly suites run only
from [`.github/workflows/nightly-testnet-e2e.yml`](../.github/workflows/nightly-testnet-e2e.yml),
on a schedule (03:00 UTC) or by manual dispatch, and never on push or PR.

| Suite                                  | Gate                                                      | What it does                                                                                                  |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Mint, fund, repay (real contracts)     | `RUN_TESTNET_E2E=true`                                    | Signs with a raw keypair in Node and submits mint / fund / repay transactions.                                |
| Real Freighter connect and sign (#1027) | `RUN_FREIGHTER_E2E=true`, plus the extension and mnemonic | Loads the real Freighter extension, connects it through `WalletConnectModal`, and signs a canned transaction. |

## Real Freighter extension suite

Mock wallets don't catch extension-specific behaviour, such as popup
windows, access grants, network mismatches and the shape of the signing
response. This suite (tagged `@freighter`) covers those:

1. Launches a persistent Chromium context with the unpacked Freighter build
   loaded (`--load-extension`).
2. Imports a **testnet-only** wallet from a recovery phrase and switches
   Freighter to Testnet. The extension password is random for each run.
3. Opens the app, clicks **Connect Wallet**, then **Connect Freighter**, and
   approves Freighter's access popup.
4. Builds a canned, low-value transaction: one `manageData` op on the
   connected account. Freighter signs it through `@stellar/freighter-api`,
   and the test then checks the signature against the account's public key.
   The transaction is **never submitted**, so it has no on-chain effect.

### Timeout budget

The whole test is limited to 4 minutes. Each step has its own limit
(`FREIGHTER_TIMEOUTS` in `e2e/helpers/freighter-extension.ts`):

| Step                           | Budget |
| ------------------------------ | ------ |
| Extension service worker boot  | 30 s   |
| Onboarding (import + network)  | 60 s   |
| Each Freighter popup           | 30 s   |
| Connect via modal              | 45 s   |
| Sign                           | 45 s   |

If testnet is down, signing still runs: Friendbot and Horizon are only used
to get a realistic sequence number. When they are unreachable, the test falls
back to an offline account.

### Required CI secrets and variables

| Name                               | Kind     | Required | Purpose                                                                                              |
| ---------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `TESTNET_E2E_FREIGHTER_MNEMONIC`   | secret   | yes      | 12/24-word recovery phrase of a wallet used **only on testnet**. Without it, the job skips.          |
| `TESTNET_E2E_FREIGHTER_PUBLIC_KEY` | secret   | no       | Expected G-address for the mnemonic. If set, the test asserts that the connected address matches it. |
| `FREIGHTER_CRX_URL`                | variable | no       | Overrides the Chrome Web Store download URL, e.g. to pin a known Freighter build.                    |
| `TESTNET_*_CONTRACT_ID`, `PINATA_JWT` | secret | yes\*    | Same app build secrets as the mint/fund/repay job.                                                   |

Environment read by the spec:

| Variable                         | Set by           | Meaning                                                              |
| -------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `RUN_FREIGHTER_E2E`              | workflow step    | Opt-in flag. Anything other than `"true"` skips the suite.            |
| `FREIGHTER_EXTENSION_PATH`       | workflow job env | Directory of the unpacked extension (must contain `manifest.json`). |
| `TESTNET_E2E_FREIGHTER_MNEMONIC` | secret           | See above.                                                           |
| `FREIGHTER_E2E_HEADLESS`         | optional         | `true` uses headless Chromium. By default it runs headed under `xvfb-run`. |

### Skip conditions

The suite calls `test.skip` with a reason, and never prints the secret
values, when any of these hold:

- `RUN_FREIGHTER_E2E` is not `"true"`. This covers local `npm run test:e2e`
  and every other workflow.
- `TESTNET_E2E_FREIGHTER_MNEMONIC` is empty. Forks and repos without the
  secret land here. The workflow's gate step also skips install and build
  in this case.
- `FREIGHTER_EXTENSION_PATH` is unset, or has no `manifest.json`. This
  happens when the extension isn't installed in the CI image or the
  download failed. The workflow emits a warning and skips the run step.

### Debugging failures

Tracing starts **after** onboarding, so the recovery phrase is never
recorded. On failure, the test attaches `freighter-trace.zip`. The job then
uploads `playwright-report/` and `test-results/` as the
`playwright-freighter-nightly` artifact. Open the trace with:

```bash
npx playwright show-trace test-results/<test-dir>/freighter-trace.zip
```

Freighter's onboarding and popup screens change between releases. If a
selector in `e2e/helpers/freighter-extension.ts` stops matching, pin a
known-good build with `FREIGHTER_CRX_URL` while you update the selectors.

### Running locally

```bash
export RUN_FREIGHTER_E2E=true
export FREIGHTER_EXTENSION_PATH=/path/to/unpacked/freighter
export TESTNET_E2E_FREIGHTER_MNEMONIC="word1 word2 ..."   # testnet-only wallet
NEXT_PUBLIC_ENABLE_MOCK_DATA=false npx playwright test e2e/testnet-nightly.spec.ts \
  --project=chromium --grep @freighter
```

### Secret hygiene

- Never commit a mnemonic, secret key or `.env` containing one. Store them
  only as GitHub Actions secrets.
- Use a dedicated wallet that holds testnet funds only. Never reuse a phrase
  that has controlled a mainnet account.
- The spec only reads secrets from `process.env` and never logs them.
