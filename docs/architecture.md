# Kora Protocol — Architecture

This document describes the technical architecture of the Kora Protocol frontend: how it is structured, how data flows, and how it integrates with Stellar Soroban.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Layer Breakdown](#layer-breakdown)
- [Data Flow](#data-flow)
- [State Management](#state-management)
- [Wallet Integration](#wallet-integration)
- [Contract Interaction](#contract-interaction)
- [Transaction Lifecycle Deep Dive](#transaction-lifecycle-deep-dive)
- [Secondary Market](#secondary-market)
- [IPFS Storage](#ipfs-storage)
- [Rendering Strategy](#rendering-strategy)
- [Security Considerations](#security-considerations)
- [Scalability Notes](#scalability-notes)

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Next.js App │  │  Zustand     │  │  TanStack Query      │  │
│  │  (App Router)│  │  (UI State)  │  │  (Server State)      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│  ┌──────▼─────────────────▼──────────────────────▼───────────┐  │
│  │                    Service Layer                           │  │
│  │  invoiceService.ts  ·  ipfs.ts  ·  stellar/contracts.ts   │  │
│  └──────────────────────────┬──────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
   ┌──────▼──────┐   ┌────────▼───────┐   ┌──────▼──────┐
   │  Soroban    │   │  Stellar       │   │  Pinata     │
   │  RPC Node   │   │  Horizon API   │   │  IPFS       │
   └─────────────┘   └────────────────┘   └─────────────┘
```

---

## Layer Breakdown

### 1. Presentation Layer (`app/`, `components/`)

- **Next.js App Router** pages handle routing and layout.
- **Server Components** are used for static/SEO content (landing page sections).
- **Client Components** (`"use client"`) handle interactivity: wallet connection, forms, charts.
- **`components/ui/`** — headless, reusable primitives (Button, Card, Input, etc.) built on Radix UI.
- **`components/invoice/`** — domain-specific components (InvoiceCard).
- **`components/wallet/`** — wallet connection UI.
- **`components/layout/`** — Navbar, shared layout elements.

### 2. Hook Layer (`hooks/`)

Hooks encapsulate all stateful logic and side effects:

| Hook | Responsibility |
|------|---------------|
| `useWallet` | Wraps Stellar Wallets Kit; exposes connect/disconnect/sign |
| `useTransaction` | Manages the full tx lifecycle with toast notifications |
| `useInvoices` | TanStack Query wrappers for invoice data fetching |

### 3. Service Layer (`services/`)

Pure functions that abstract data access:

| Service | Responsibility |
|---------|---------------|
| `invoiceService.ts` | Fetch invoices, prepare mint/fund transactions |
| `mockData.ts` | Static mock data for development |

The service layer is the **only** place that calls `lib/stellar/` or `lib/ipfs.ts`. Components never call these directly.

### 4. Library Layer (`lib/`)

Low-level utilities and clients:

| Module | Responsibility |
|--------|---------------|
| `lib/stellar/client.ts` | Soroban RPC + Horizon singletons |
| `lib/stellar/contracts.ts` | Contract call builders (unsigned XDR) |
| `lib/ipfs.ts` | Pinata upload helpers |
| `lib/utils.ts` | Formatting, class merging, constants |
| `lib/validations/` | Zod schemas for form validation |

### 5. State Layer (`store/`)

Zustand stores for global client state:

| Store | State |
|-------|-------|
| `walletStore` | Wallet address, connection status, balances (persisted to localStorage) |
| `invoiceStore` | Marketplace filters, sort, search query |
| `uiStore` | Modal open/close, transaction status |

---

## Data Flow

### Read Flow (Marketplace)

```
User visits /marketplace
    │
    ▼
useInvoices() [TanStack Query]
    │
    ▼
fetchInvoices(filters, sort) [invoiceService.ts]
    │
    ├── MOCK_DATA=true → return MOCK_INVOICES (filtered/sorted)
    │
    └── MOCK_DATA=false → fetch from on-chain indexer / Soroban RPC
    │
    ▼
InvoiceCard components render
```

### Write Flow (Fund Invoice)

```
User clicks "Fund Invoice"
    │
    ▼
handleFund() in [id]/page.tsx
    │
    ▼
useTransaction().execute(buildFn)
    │
    ├── buildFn() → prepareFundInvoice() [invoiceService.ts]
    │                   └── marketplaceContract.fundInvoice() [contracts.ts]
    │                           └── buildContractCall() → unsigned XDR
    │
    ├── signTransaction(xdr) [useWallet → StellarWalletsKit]
    │       └── Wallet extension prompts user
    │
    └── submitAndConfirm(signedXdr) [invoiceService.ts]
            ├── submitTransaction() [client.ts → Soroban RPC]
            └── waitForTransaction() [polls until confirmed]
    │
    ▼
Toast notification + UI update
```

---

## State Management

We use **two separate state systems** for different concerns:

### Server State — TanStack Query

- Invoice listings, individual invoice data
- Automatic background refetching, caching, deduplication
- Cache keys: `["invoices", filters, sort]`, `["invoice", id]`

#### Query tuning per network mode

Stale times and refetch intervals are **not fixed** — they are resolved per
network mode from the `QUERY_TUNING` table in [`lib/featureFlags.ts`](lib/featureFlags.ts)
via `getQueryTuning()`. The two modes have fundamentally different freshness
characteristics:

| | `live` | `mock` |
|---|---|---|
| Data source | Soroban RPC / indexer | static `MOCK_INVOICES` fixture |
| Freshness driver | **contract events** (`useContractEvents`) | nothing — data is immutable |
| `staleTime` | 5 s | 5 min |
| `gcTime` | 5 min | 5 min |
| Refetch timers | 2 min (backstop only) | disabled (`false`) |

**Live mode is event-driven.** `useContractEvents` streams `invoice_funded` /
`invoice_repaid` / `invoice_cancelled` and invalidates the affected query keys
as they arrive, so timers are a safety net for a degraded stream rather than the
primary freshness mechanism. The short 5 s `staleTime` exists so that an
event-invalidated query refetches promptly instead of serving a stale entry.

Pushing the timers out to 2 min is what removes the duplicate requests: the
previous fixed 15 s / 30 s polls raced the event stream, refetching keys the
stream had already invalidated seconds earlier.

**Mock mode disables polling entirely.** The fixture cannot change, so every
refetch returned a byte-identical result. Mutations still invalidate explicitly,
so optimistic updates and the invoice wizard are unaffected.

All timers are additionally gated on tab visibility (`whenVisible()` in
`hooks/useInvoices.ts`); a hidden tab refreshes on `visibilitychange` instead.

**Changing the timings:** edit `QUERY_TUNING` in `lib/featureFlags.ts` — that
table is the single source of truth. `getNetworkMode()` there also backs
`getInvoiceDataSource()` in `lib/queryKeys.ts`, so cache-key namespacing and
query tuning can never disagree about which mode is active.

### Client State — Zustand

- **walletStore**: Persisted to `localStorage` via `zustand/middleware/persist`. Survives page refresh.
- **invoiceStore**: Ephemeral marketplace filter/sort state.
- **uiStore**: Ephemeral modal and transaction status.

**Rule:** Never put server data in Zustand. Never put UI state in TanStack Query.

---

## Wallet Integration

Kora uses [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit) to support multiple Stellar wallets through a unified API.

```
useWallet hook
    │
    ▼
StellarWalletsKit (singleton)
    │
    ├── Freighter (browser extension)
    ├── xBull (browser extension)
    ├── LOBSTR (browser extension)
    └── Albedo (web-based signer)
```

The kit is instantiated lazily on first use and reused across the session. On disconnect, the singleton is cleared.

**Wallet state persistence:** The wallet address and provider are persisted to `localStorage`. On page load, if a stored address exists, the UI shows as connected — but the actual kit session must be re-established on the next transaction (the wallet extension handles this transparently).

**Per-wallet settings persistence:** `settingsStore` keys its persisted bucket by the connected wallet: the zustand persist name rotates to `kora-settings-store-${ADDRESS}` (uppercased/normalised — see `settingsStorageKey()` in `store/settingsStore.ts`). A `SettingsWalletSync` subscriber in `app/providers.tsx` watches `walletStore.address` and calls `setActiveWallet()`, which snapshots the outgoing wallet, rotates the persist key and rehydrates the incoming wallet's bucket. Consequences:

- Two wallets sharing a browser keep independent notification preferences, concentration thresholds, dismissals and tour progress.
- Switching (or disconnecting then reconnecting) never leaks one profile's thresholds into another; a reconnect restores exactly what that wallet saved.
- Disconnecting is intentionally a no-op for the active bucket (the settings surface is wallet-gated), so a plain reconnect does not reset the user to defaults.
- The disconnected bucket keeps the base key `kora-settings-store`; it is also where the one-time migration from the legacy `uiStore`/`invoiceStore` notification copies reads from.

**PWA manifest:** `/manifest.json` is a locale-aware route handler (`app/manifest.json/route.ts` → `lib/pwa/manifest.ts`) rather than a static file, so shortcut labels match the active locale. Shortcut URLs remain locale-agnostic app paths; the locale is carried by the `kora-locale` cookie.

---

## Contract Interaction

All Soroban contract interactions follow this pattern:

```typescript
// 1. Build (client-side, no signature needed)
const tx = await buildContractCall({ contractId, method, args, sourcePublicKey });
// → Simulates the transaction to get resource footprint
// → Returns an assembled Transaction object

// 2. Serialize to XDR for wallet signing
const unsignedXdr = tx.toXDR();

// 3. Sign (wallet extension)
const signedXdr = await walletKit.signTransaction(unsignedXdr, { ... });

// 4. Submit
const result = await rpc.sendTransaction(tx);

// 5. Confirm (poll)
const confirmed = await waitForTransaction(result.hash);
```

This separation means the frontend **never holds private keys**. The wallet extension is the only signer.

---

## Transaction Lifecycle Deep Dive

Every write operation (mint, fund, repay, claim yield) goes through the same
hook: `useTransaction`. This section traces a single call through
`execute()` end to end, and documents the `TxState` machine it drives.

### Actors

| Actor | Role |
|-------|------|
| `useTransaction` | Owns the lifecycle. Holds local React state (source of truth for the calling component) and mirrors it into `uiStore`. |
| `walletStore` | Read-only from the tx lifecycle's perspective. Supplies nothing directly — `useWallet` reads/writes it for connection state, and `useTransaction` only consumes `signTransaction`/`publicKey` from `useWallet`. |
| `uiStore` | Holds `txState`, a globally-readable mirror of the current stage. Lets UI outside the initiating component (e.g. a persistent status indicator) react without prop drilling. |
| `transactionHistoryStore` | Records every submitted transaction (`pending` → `confirmed`/`failed`) for the Transaction History page. Written to only after a hash exists, i.e. from `submitting` onward. |
| Soroban RPC | Simulates, submits, and is polled for confirmation. |

### Sequence: Fund Invoice

```mermaid
sequenceDiagram
    actor User
    participant UI as Component (FundPanel)
    participant TX as useTransaction
    participant SVC as invoiceService / contracts.ts
    participant RPC as Soroban RPC
    participant WK as useWallet (StellarWalletsKit)
    participant HIST as transactionHistoryStore

    User->>UI: Click "Fund Invoice"
    UI->>TX: execute(buildFn, options)
    TX->>TX: setStage("building") → mirrors to uiStore.txState
    TX->>SVC: buildFn() → prepareFundInvoice()
    SVC->>SVC: marketplaceContract.fundInvoice()
    SVC-->>TX: unsigned XDR
    TX->>TX: setStage("simulating")
    TX->>RPC: simulateTransaction(tx)
    RPC-->>TX: SimulationSuccess | SimulationError
    alt simulation failed
        TX->>TX: setStage("failed", error)
        TX-->>UI: toast.error(...)
    else simulation succeeded
        opt onSimulationPreview provided
            TX-->>UI: fee / resource preview
            UI-->>TX: proceed = true/false
            alt declined
                TX->>TX: reset to "idle" — execute() returns null
            end
        end
        TX->>TX: setStage("signing")
        TX->>WK: signTransaction(unsignedXdr)
        WK->>User: Wallet extension prompts for signature
        User-->>WK: Approve
        WK-->>TX: signedXdr
        TX->>TX: setStage("submitting")
        TX->>RPC: sendTransaction(signedXdr)
        RPC-->>TX: {hash, status}
        TX->>HIST: addTransaction({hash, status: "pending"})
        TX->>TX: setStage("polling", txHash)
        loop exponential backoff, up to 30 attempts / 5 min
            TX->>RPC: getTransaction(hash)
            RPC-->>TX: NOT_FOUND | SUCCESS | FAILED
        end
        alt confirmed
            TX->>TX: setStage("confirmed", txHash)
            TX->>HIST: updateTransactionStatus(hash, "confirmed")
            TX-->>UI: toast.success(...) → options.onSuccess(hash)
        else failed or timed out
            TX->>TX: setStage("failed", error)
            TX->>HIST: updateTransactionStatus(hash, "failed", message)
            TX-->>UI: toast.error(...)
        end
    end
```

Every `setStage()` call does two things: it updates `useTransaction`'s local
`useState` (what the calling component reads to disable buttons / show
spinners) and calls `uiStore.setTxState()` with the same status, so any
other part of the tree can observe tx progress. For in-progress stages
(`building`, `simulating`, `signing`, `submitting`, `polling`) it also
drives a single loading toast (`TOAST_ID = "kora-tx"`), which is replaced
in place by the final success/error toast rather than stacking.

### The `TxState` machine

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> building: execute(buildFn) called
    building --> simulating: real transaction (not a "mock_" XDR)
    building --> signing: mock XDR — simulation skipped (demo / test mode)
    simulating --> failed: simulateTransaction() returns an error
    simulating --> idle: onSimulationPreview resolves false (caller declines)
    simulating --> signing: simulation succeeds (preview optionally confirmed by caller)
    signing --> failed: wallet rejects, or signTransaction() throws
    signing --> submitting: signedXdr obtained
    submitting --> failed: sendTransaction() returns status "ERROR"
    submitting --> polling: hash received; recorded in transactionHistoryStore as "pending"
    polling --> confirmed: getTransaction() returns "SUCCESS"
    polling --> failed: getTransaction() returns "FAILED", or the 30-attempt / 5-minute timeout elapses
    confirmed --> idle: reset() — component starts a new tx or unmounts
    failed --> idle: reset() — via the error toast's dismiss action, or a new tx attempt
```

`TxLifecycleStatus` (in `useTransaction.ts`) also defines a `retrying`
status, reserved for recovering from `BadSequenceError` (thrown by
`submitTransaction` in `lib/stellar/client.ts` when the network reports
`tx_bad_seq`). When set, it is mirrored to `uiStore.txState` as
`"submitting"` rather than a new state, since `TxState` (in
`types/contract.ts`) doesn't define a `retrying` variant — shared UI that
only reads `uiStore.txState` doesn't need to special-case it. Note this
mapping happens in code but nothing in `execute()` currently drives a
transition into `retrying`; treat it as a documented extension point for
sequence-number retry handling, not a path exercised by the flow above.

### Store responsibilities at each stage

| Stage | `uiStore.txState` | `transactionHistoryStore` | Toast |
|-------|--------------------|-----------------------------|-------|
| `idle` | `{ status: "idle" }` | — | dismissed |
| `building` / `simulating` / `signing` | mirrors status | — | loading |
| `submitting` | mirrors status | — | loading |
| `polling` | `{ status: "polling", txHash }` | `addTransaction({ hash, status: "pending", ... })` | loading |
| `confirmed` | `{ status: "confirmed", txHash }` | `updateTransactionStatus(hash, "confirmed")` | success |
| `failed` | `{ status: "failed", error, txHash? }` | `updateTransactionStatus(hash, "failed", message)` if a hash exists | error, with a dismiss action that calls `reset()` |

`walletStore` is never written to by `useTransaction`. It only supplies
`publicKey` and `signTransaction` (via `useWallet`) for the `signing`
stage — wallet connection state changes independently, through
`useWallet`'s own connect/disconnect flow.

---

## Secondary Market

The secondary market lets an investor sell a position they already hold to
another buyer (P2P). It is gated behind the `secondary-market` feature flag
(`NEXT_PUBLIC_ENABLE_SECONDARY_MARKET` in [`lib/featureFlags.ts`](lib/featureFlags.ts)).

### Route

- `/secondary` — client page (`app/secondary/page.tsx`), wrapped in `Suspense`.
  It composes the listing grid, filters/sort, seller analytics, and the
  acquire/accept dialogs into one client component.
- `/dashboard/investor` — where a seller marks a position "for sale" via
  `listPosition` (and can unlist it).
- Shareable filter/sort state (`q`, `tenor`, `yield`, `seller`, `highlight`)
  is read from and written to the URL via
  [`lib/secondaryUrlFilters.ts`](lib/secondaryUrlFilters.ts) (#643);
  pure sort logic lives in [`lib/secondarySort.ts`](lib/secondarySort.ts).

### Stores

[`store/positionListingStore.ts`](store/positionListingStore.ts) is a persisted
Zustand store (localStorage key `kora-position-listings`) tracking
`PositionListingMeta` entries keyed by position id. Listing is UI-only (#442):
it records the seller's intent and ask price, while the on-chain sale happens
separately through `prepareTransferPosition` in
[`services/invoiceService.ts`](services/invoiceService.ts) (#443).

| Action | Purpose |
|--------|---------|
| `listPosition` / `unlistPosition` | Add/remove a listing; preserves `listedAt` when re-listing at a new price |
| `reconcileListings(ownedPositionIds)` | Prunes listings for positions the wallet no longer holds — run after every successful `usePositions` fetch (`hooks/usePositions.ts`) |
| `getListingsByInvoiceToken(tokenId)` | Per-invoice listing depth, rendered by `components/invoice/InvoiceOrderBookDepth.tsx` |

### Fee helpers

[`lib/secondaryFees.ts`](lib/secondaryFees.ts) is the single source of truth
for secondary-market fee arithmetic (#597); UI never computes fees itself, it
only formats what `computeAcquisitionFees` returns. Schedules are configured in
basis points in validated env (`lib/env.ts`): protocol fee defaults to 50 bps,
market fee to 25 bps. The total is derived by summing the individually-rounded
parts so a disclosed breakdown always reconciles with the total.

[`components/secondary/FeeDisclosure.tsx`](components/secondary/FeeDisclosure.tsx)
renders that breakdown on each listing card (`inline` variant) and inside the
dialogs (`full` variant).

### Dialogs

| Dialog | Issue | Purpose |
|--------|-------|---------|
| `components/invoice/AcquirePositionDialog.tsx` | #642 | Confirms an acquisition before any tx is built; surfaces implied-discount/premium risk banners |
| `components/invoice/AcceptTransferDialog.tsx` | #732 | Buyer accept-position transfer shell; shows a graceful NOT_IMPLEMENTED banner until the transfer ABI is confirmed |
| `components/secondary/FeeDisclosure.tsx` | #597 | Fee breakdown (see above) |

### Buyer flow

Acquire and accept-transfer run through the same simulation gate
(`build → simulate → preview → sign → submit → poll`) as fund/transfer:

```mermaid
sequenceDiagram
    actor User
    participant UI as /secondary page
    participant Dlg as AcquirePositionDialog
    participant FLOW as useAcquirePositionFlow / useTransferPositionFlow
    participant TX as useTransaction
    participant SVC as invoiceService / contracts.ts
    participant RPC as Soroban RPC
    participant WK as useWallet

    User->>UI: Click "Acquire Position"
    UI->>Dlg: open dialog (risk banners)
    Dlg->>UI: onConfirm()
    UI->>FLOW: acquirePosition(positionId, buyer, seller)
    FLOW->>TX: tx.execute(buildFn)
    TX->>SVC: buildFn() → prepareTransferPosition()
    SVC-->>TX: unsigned XDR (assumed `transfer_position` ABI, #443)
    TX->>RPC: simulate + preview gate
    TX->>WK: sign
    TX->>RPC: submit + poll
    TX-->>UI: toast + listing update
```

`useTransferPositionFlow().acceptTransfer` is currently a stub that routes
`prepareAcceptPositionTransfer`'s NOT_IMPLEMENTED error through the standard
toast path. The integration point and assumptions for wiring in a future
buyer-accept contract call are documented on that function
(`services/invoiceService.ts:949`).

---

## IPFS Storage

Invoice documents and metadata are stored on IPFS via Pinata:

```
Create Invoice flow
    │
    ├── uploadFileToPinata(pdf) → docCid
    │
    ├── Build metadata JSON { ...invoiceData, documentHash: docCid }
    │
    └── uploadJsonToPinata(metadata) → metadataCid
            │
            └── metadataCid passed to mint_invoice() on-chain
```

The on-chain NFT stores only the IPFS CID. The full metadata is always retrievable from IPFS, making it tamper-proof and permanent.

---

## Rendering Strategy

| Page | Strategy | Reason |
|------|----------|--------|
| `/` (Landing) | Static + Client hydration | SEO, animations |
| `/marketplace` | Client | Dynamic filters, wallet state |
| `/marketplace/[id]` | SSR/ISR + Client | Server `generateMetadata` + JSON-LD/OG from IPFS; client fund panel |
| `/secondary` | Client | Dynamic filters, wallet state, dialogs |
| `/invoice/create` | Client | Form, file upload, wallet |
| `/dashboard/sme` | Client | Wallet-gated |
| `/dashboard/investor` | Client | Wallet-gated |
| `/analytics` | Client | Charts, wallet-gated |

Most interactive pages are client-rendered because they require wallet state. Invoice detail pages use SSR/ISR for SEO: `generateMetadata` hydrates OG tags from invoice + IPFS metadata, server-rendered JSON-LD, SVG Open Graph previews, and sitemap entries for `/marketplace/[id]`.

---

## Security Considerations

1. **No private keys in the frontend.** All signing is delegated to wallet extensions.
2. **Environment variables.** Only `NEXT_PUBLIC_*` variables are exposed to the browser. `PINATA_JWT` is server-only and read exclusively by the `/api/upload` route (`app/api/upload/route.ts`), which verifies a CSRF token (`lib/csrf.ts`) before pinning or unpinning. Client helpers in `lib/ipfs.ts` never see the JWT — they post to `/api/upload`; the only direct browser call to Pinata is the unauthenticated `checkPinataHealth()` reachability probe. See [`SECURITY.md`](../SECURITY.md) and [`.env.example`](../.env.example).
3. **Input validation.** All form inputs are validated with Zod before any contract call is built.
4. **IPFS content addressing.** Invoice documents are content-addressed — the CID stored on-chain is a cryptographic hash of the content, making tampering detectable.
5. **Contract simulation.** Every transaction is simulated before signing. Simulation errors surface to the user before they're asked to sign.
6. **No custodial funds.** The frontend never holds or transfers user funds directly. All value flows through Soroban smart contracts.
7. **PWA Service Worker Cache Security.** Wallet-gated and sensitive routes (`/dashboard/*`, `/transactions/*`, `/invoice/create/*`, `/api/*`) are explicitly excluded from Service Worker caching (`NetworkOnly` rule in `next.config.js`) and serve HTTP `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` headers. Service worker update listeners guard against reloads during active wallet cryptographic signing sessions.

---

## Scalability Notes

- **Indexer:** For production, replace `fetchInvoices` with a dedicated indexer (e.g., a Soroban event indexer or a custom backend) rather than querying the RPC directly for listings.
- **Pagination:** The service layer already supports `page` and `pageSize` parameters. The marketplace UI can be extended with infinite scroll or pagination controls.
- **Caching:** TanStack Query's `staleTime` is set to 30s for listings and 60s for individual invoices. Adjust based on on-chain update frequency.
- **Multi-network:** The network is read from `NEXT_PUBLIC_STELLAR_NETWORK`. Switching to mainnet requires only an environment variable change and redeployment.

---

## Deployment & CI

- **Build:** The project builds with `next build` and is deployed as a static/SSR hybrid depending on the hosting platform.
- **CI:** CI should run `npm ci`, `npm run lint`, and `npm test` before publishing artifacts.
- **Secrets:** Use the hosting provider's secret store for server-only variables (e.g., `PINATA_JWT`, private indexer keys). Do not expose them as `NEXT_PUBLIC_*`.

### Web Vitals regression gate

`e2e/performance.spec.ts` runs two performance checks, and they are gated
differently on purpose:

| Check | Measures | CI behaviour |
|---|---|---|
| Marketplace load test | Wall-clock timings of a scripted scroll | **Warn only** — too noisy on shared runners to block a merge |
| Web Vitals gate | Browser-reported LCP, CLS, TTFB, FCP for one page load | **Fails the build** |

The gate is **relative, not absolute**. `VITAL_THRESHOLDS` in `lib/webVitals.ts`
already answers *"is this page fast enough"*, but a PR can double LCP while
staying comfortably under 2500 ms and nothing would notice until it crosses the
bar months later. `evaluateVitalsRegression()` instead compares each run against
the `webVitals` block in [`performance-baseline.json`](performance-baseline.json)
and fails when a metric grew by more than **10%**.

To keep the false-positive rate survivable on shared CI hardware, a metric must
breach **both** a proportional and an absolute floor (`REGRESSION_MIN_DELTA`).
A TTFB moving 8 ms → 9 ms is +12.5% but is indistinguishable from runner noise,
so it does not fail. Metrics absent from either the run or the baseline are
skipped rather than failed — but a run where *nothing* could be compared fails
too, since that means the collector broke rather than that everything passed.

#### Updating the baseline

When a change makes a metric legitimately slower — a deliberate trade-off, a new
above-the-fold feature — update the baseline rather than loosening the threshold:

```bash
UPDATE_VITALS_BASELINE=true npx playwright test e2e/performance
```

Then commit the regenerated `performance-baseline.json` **in the same PR**, and
say in the description why the regression is acceptable.

> **Never** update the baseline on `main` to turn a red build green. That
> silently ratchets the budget upward and defeats the point of the gate.

The same spec also POSTs its measurements to `/api/vitals`, so the ingest
endpoint gets synthetic traffic on every CI run and a broken handler surfaces in
CI instead of silently dropping real user metrics in production.

## Appendix / Glossary

- **Soroban:** Stellar's smart contract platform.
- **Horizon:** Stellar's REST API for account and ledger data.
- **CID:** Content Identifier for IPFS objects.

## Contact

For architecture questions or proposals, open an issue or contact the core maintainers in the repository.
