/**
 * Stellar/Soroban RPC client singleton.
 * Reads network config from environment variables.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  AccountBalances,
  AccountTransaction,
  PaginatedTransactions,
} from "@/types/stellar";

const RPC_URL = env.NEXT_PUBLIC_STELLAR_RPC_URL;
const NETWORK_PASSPHRASE = env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
const HORIZON_URL = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;

// Soroban RPC client
export const rpc = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: false });

// Horizon server (for account info, balances)
export const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

export const networkConfig = {
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  horizonUrl: HORIZON_URL,
};

// ─── Sequence Manager ─────────────────────────────────────────────────────────

export class SequenceManager {
  // address → current local sequence number (as string to match StellarSdk)
  private readonly counters = new Map<string, bigint>();
  // address → in-progress reset promise (deduplicate concurrent resets)
  private readonly resetPromises = new Map<string, Promise<bigint>>();

  /**
   * Returns a StellarSdk.Account whose sequence number is the next value to
   * use. Increments the local counter optimistically so the next caller gets
   * seq+1 without waiting for network confirmation.
   */
  async nextAccount(address: string): Promise<StellarSdk.Account> {
    if (!this.counters.has(address)) {
      // First use for this address — fetch from network and seed the counter.
      await this.fetchAndSeed(address);
    }

    const seq = this.counters.get(address)!;
    // Increment before returning so the *next* concurrent call gets seq+1.
    this.counters.set(address, seq + BigInt(1));

    // StellarSdk.Account constructor takes the *current* (pre-increment) seq
    // and internally adds 1 when building. So we pass seq (not seq+1).
    return new StellarSdk.Account(address, seq.toString());
  }

  /**
   * Reset the local counter from the network (authoritative value).
   * Called after a tx_bad_seq error. Deduplicates concurrent calls so a
   * flurry of failures only triggers one network request.
   */
  async reset(address: string): Promise<void> {
    await this.fetchAndSeed(address);
  }

  /**
   * Explicitly evict a counter (e.g. on wallet disconnect).
   */
  evict(address: string): void {
    this.counters.delete(address);
    this.resetPromises.delete(address);
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async fetchAndSeed(address: string): Promise<bigint> {
    // Deduplicate: if a reset is already in-flight for this address, wait for
    // it instead of launching a second network request.
    const existing = this.resetPromises.get(address);
    if (existing) return existing;

    const promise = rpc
      .getAccount(address)
      .then((account) => {
        const seq = BigInt(account.sequenceNumber());
        this.counters.set(address, seq);
        return seq;
      })
      .finally(() => {
        this.resetPromises.delete(address);
      });

    this.resetPromises.set(address, promise);
    return promise;
  }
}

export const sequenceManager = new SequenceManager();

// ─── USDC asset definition ────────────────────────────────────────────────────

/**
 * The canonical USDC asset on Stellar (issued by Centre / Circle).
 * Issuer is the same on both testnet and mainnet for the official asset.
 */
export const USDC_ASSET = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
);

// ─── Custom error types ───────────────────────────────────────────────────────

export class AccountNotFoundError extends Error {
  constructor(address: string) {
    super(`Account not found: ${address}`);
    this.name = "AccountNotFoundError";
  }
}

export class HorizonRateLimitError extends Error {
  constructor() {
    super("Horizon rate limit exceeded. Please try again shortly.");
    this.name = "HorizonRateLimitError";
  }
}

export class HorizonNetworkError extends Error {
  constructor(message: string) {
    super(`Horizon network error: ${message}`);
    this.name = "HorizonNetworkError";
  }
}

// ─── Horizon error normaliser ─────────────────────────────────────────────────

/**
 * Maps any Horizon failure onto one of the typed errors above so hooks can
 * render stable messages:
 *
 * - HTTP 404            → `AccountNotFoundError`
 * - HTTP 429            → `HorizonRateLimitError`
 * - other HTTP status   → `HorizonNetworkError("HTTP <status>: …")`
 * - no response (offline, DNS, CORS, non-Error throws) → `HorizonNetworkError`
 *
 * Exported for unit tests (`lib/__tests__/stellar-client-horizon.test.ts`);
 * app code should rely on the public helpers that call it.
 */
export function normaliseHorizonError(err: unknown, address?: string): never {
  if (err instanceof Error) {
    // Horizon SDK wraps HTTP errors — check the response status
    const anyErr = err as { response?: { status?: number } };
    const status = anyErr.response?.status;

    if (status === 404) throw new AccountNotFoundError(address ?? "unknown");
    if (status === 429) throw new HorizonRateLimitError();
    if (status !== undefined) throw new HorizonNetworkError(`HTTP ${status}: ${err.message}`);
  }
  throw new HorizonNetworkError(String(err));
}

// ─── Horizon 429 retry policy ─────────────────────────────────────────────────
//
// Bursty dashboard polling can trip Horizon's per-IP rate limit. Read-only
// Horizon calls are wrapped in `withHorizonRetry`, which retries ONLY on
// HTTP 429 with exponential backoff + jitter, honours `Retry-After` (or
// `X-Ratelimit-Reset`) when present, and gives up after a capped number of
// attempts. Every other error fails fast. Never wrap non-idempotent writes
// (transaction submission) — a retried submit could double-spend a sequence.

export interface HorizonRetryOptions {
  /** Total attempts including the first call. */
  maxAttempts?: number;
  /** Backoff base for the first retry; doubles on each subsequent retry. */
  baseDelayMs?: number;
  /** Upper bound for a computed backoff delay. */
  maxDelayMs?: number;
  /** Server-requested waits longer than this abort retrying instead. */
  maxRetryAfterMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; returns a value in [0, 1). */
  random?: () => number;
}

export const HORIZON_RETRY_DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 30_000,
} as const;

/** Degraded-state warnings are logged at most once per this window. */
export const HORIZON_DEGRADED_LOG_WINDOW_MS = 60_000;

let lastDegradedLogAt = 0;
/** Shared cooldown so concurrent callers back off together after a 429. */
let horizonCooldownUntil = 0;

/** Test-only: reset module-level retry state between tests. */
export function __resetHorizonRetryState(): void {
  lastDegradedLogAt = 0;
  horizonCooldownUntil = 0;
}

type HorizonHttpError = {
  response?: {
    status?: number;
    headers?: Record<string, string | undefined> | { get?: (name: string) => string | null };
  };
};

function readHeader(err: unknown, name: string): string | undefined {
  const headers = (err as HorizonHttpError)?.response?.headers;
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get: (n: string) => string | null }).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | undefined>;
  return record[name] ?? record[name.toLowerCase()];
}

/** True when the error is a Horizon HTTP 429 (raw SDK error or normalised). */
export function isHorizonRateLimited(err: unknown): boolean {
  if (err instanceof HorizonRateLimitError) return true;
  return (err as HorizonHttpError)?.response?.status === 429;
}

/**
 * Parse the server-requested wait from `Retry-After` (seconds or HTTP-date),
 * falling back to Horizon's `X-Ratelimit-Reset` (seconds). Returns `null`
 * when neither header is present or parseable.
 */
export function parseRetryAfterMs(err: unknown, now = Date.now()): number | null {
  const retryAfter = readHeader(err, "retry-after");
  if (retryAfter !== undefined && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  const reset = readHeader(err, "x-ratelimit-reset");
  if (reset !== undefined) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return null;
}

/**
 * Exponential backoff with "equal jitter": half the window is fixed, half is
 * random, so concurrent callers spread out without ever retrying instantly.
 */
export function computeHorizonBackoffMs(
  retry: number,
  baseDelayMs: number = HORIZON_RETRY_DEFAULTS.baseDelayMs,
  maxDelayMs: number = HORIZON_RETRY_DEFAULTS.maxDelayMs,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** retry);
  return Math.round(exp / 2 + random() * (exp / 2));
}

function logHorizonDegraded(context: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastDegradedLogAt < HORIZON_DEGRADED_LOG_WINDOW_MS) return;
  lastDegradedLogAt = now;
  logger.warn("[horizon] rate limited (HTTP 429); backing off", context);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an idempotent Horizon read, retrying on HTTP 429 only.
 *
 * Re-throws the last error unchanged so callers can still pass it through
 * `normaliseHorizonError`.
 */
export async function withHorizonRetry<T>(
  fn: () => Promise<T>,
  options: HorizonRetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = HORIZON_RETRY_DEFAULTS.maxAttempts,
    baseDelayMs = HORIZON_RETRY_DEFAULTS.baseDelayMs,
    maxDelayMs = HORIZON_RETRY_DEFAULTS.maxDelayMs,
    maxRetryAfterMs = HORIZON_RETRY_DEFAULTS.maxRetryAfterMs,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attempt = 1; ; attempt++) {
    const cooldown = horizonCooldownUntil - Date.now();
    if (cooldown > 0) await sleep(cooldown);

    try {
      return await fn();
    } catch (err) {
      if (!isHorizonRateLimited(err) || attempt >= maxAttempts) throw err;

      const backoff = computeHorizonBackoffMs(attempt - 1, baseDelayMs, maxDelayMs, random);
      const retryAfter = parseRetryAfterMs(err);
      if (retryAfter !== null && retryAfter > maxRetryAfterMs) throw err;

      const delay = Math.max(backoff, retryAfter ?? 0);
      horizonCooldownUntil = Math.max(horizonCooldownUntil, Date.now() + delay);

      logHorizonDegraded({ attempt, maxAttempts, delayMs: delay, retryAfterMs: retryAfter });
    }
  }
}

// ─── Account helpers ──────────────────────────────────────────────────────────

/**
 * Fetch raw account details from Horizon.
 */
export async function getAccount(publicKey: string) {
  return withHorizonRetry(() => horizon.loadAccount(publicKey));
}

/**
 * Fetch typed XLM + USDC + all token balances for a given account.
 *
 * - XLM balance has the minimum reserve subtracted so callers see spendable XLM.
 * - USDC is parsed from the trustline matching the canonical USDC issuer.
 * - All other credit assets are included in `otherAssets`.
 *
 * Throws `AccountNotFoundError` if the account does not exist on-chain.
 */
export async function getAccountBalances(address: string): Promise<AccountBalances> {
  let account: Awaited<ReturnType<typeof horizon.loadAccount>>;
  try {
    account = await withHorizonRetry(() => horizon.loadAccount(address));
  } catch (err) {
    normaliseHorizonError(err, address);
  }

  // Guard against proxies / misconfigured Horizon URLs returning a 200 with a
  // body that is not an account record — surface it as a Horizon error rather
  // than an opaque TypeError from iterating `undefined`.
  if (!account || !Array.isArray(account.balances)) {
    throw new HorizonNetworkError("malformed account response");
  }

  let xlm = "0";
  let usdc = "0";
  const otherAssets: AccountBalances["otherAssets"] = [];

  for (const b of account.balances) {
    if (b.asset_type === "native") {
      // Subtract the base reserve (0.5 XLM per entry) so callers see spendable balance
      const raw = parseFloat(b.balance);
      const subentryCount =
        "subentry_count" in account ? (account as { subentry_count: number }).subentry_count : 0;
      const reserve = (2 + subentryCount) * 0.5;
      xlm = Math.max(0, raw - reserve).toFixed(7);
    } else if (
      b.asset_type === "credit_alphanum4" ||
      b.asset_type === "credit_alphanum12"
    ) {
      const code = b.asset_code;
      const issuer = b.asset_issuer;

      if (code === "USDC" && issuer === USDC_ASSET.getIssuer()) {
        usdc = b.balance;
      } else {
        otherAssets.push({ code, issuer, balance: b.balance });
      }
    }
  }

  return { xlm, usdc, otherAssets };
}

/**
 * Returns only the USDC trustline balance as a number.
 * Returns `0` if the account has no USDC trustline.
 *
 * Throws `AccountNotFoundError` if the account does not exist.
 */
export async function getUSDCBalance(address: string): Promise<number> {
  const balances = await getAccountBalances(address);
  return parseFloat(balances.usdc);
}

/**
 * Returns `true` if the account exists on Horizon, `false` if it does not.
 * Used before attempting to fund a new account.
 *
 * Network errors other than 404 are re-thrown.
 */
export async function checkAccountExists(address: string): Promise<boolean> {
  try {
    await withHorizonRetry(() => horizon.loadAccount(address));
    return true;
  } catch (err) {
    const anyErr = err as { response?: { status?: number } };
    if (anyErr.response?.status === 404) return false;
    // Re-throw unexpected errors
    normaliseHorizonError(err, address);
  }
}

/**
 * Funds a testnet account with XLM via Friendbot.
 */
export async function fundTestnetAccount(address: string): Promise<void> {
  const url = `https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`;
  const response = await fetch(url);

  if (!response.ok) {
    let message = `Friendbot request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string" && data.detail.length > 0) {
        message = data.detail;
      }
    } catch {
      // best-effort parse only
    }
    throw new Error(message);
  }
}

// ─── Transaction history ──────────────────────────────────────────────────────

/**
 * Fetch paginated transaction history for an account from Horizon.
 *
 * @param address  - Stellar public key
 * @param limit    - Number of records per page (1–200, default 20)
 * @param cursor   - Paging token from a previous response for cursor-based pagination
 *
 * Returns a `PaginatedTransactions` object with the records and the next cursor.
 * Throws `AccountNotFoundError` if the account does not exist.
 */
export async function getAccountTransactions(
  address: string,
  limit = 20,
  cursor?: string
): Promise<PaginatedTransactions> {
  let builder = horizon
    .transactions()
    .forAccount(address)
    .limit(Math.min(Math.max(limit, 1), 200))
    .order("desc");

  if (cursor) {
    builder = builder.cursor(cursor);
  }

  let page: Awaited<ReturnType<typeof builder.call>>;
  try {
    page = await withHorizonRetry(() => builder.call());
  } catch (err) {
    normaliseHorizonError(err, address);
  }

  const records: AccountTransaction[] = page.records.map((tx) => ({
    id: tx.id,
    hash: tx.hash,
    createdAt: tx.created_at,
    sourceAccount: tx.source_account,
    fee: String(tx.fee_charged),
    successful: tx.successful,
    memo: tx.memo ?? null,
    memoType: tx.memo_type ?? null,
    operationCount: tx.operation_count,
    pagingToken: tx.paging_token,
    ledger: tx.ledger_attr,
  }));

  // The next cursor is the paging_token of the last record
  const nextCursor =
    records.length > 0 ? records[records.length - 1].pagingToken : undefined;

  return {
    records,
    nextCursor,
    hasMore: records.length === limit,
  };
}

// ─── Contract Events ──────────────────────────────────────────────────────────

/**
 * Supported Kora contract event types emitted by the Soroban contracts.
 */
export type KoraEventType =
  | "mint_invoice"
  | "invoice_funded"
  | "invoice_repaid"
  | "invoice_cancelled"
  | "yield_distributed";

/**
 * Parsed representation of a single Soroban contract event.
 */
export interface ContractEvent {
  /** Unique event identifier (ledger + tx index) */
  id: string;
  /** Ledger sequence number this event was emitted in */
  ledger: number;
  /** ISO timestamp of the ledger close */
  ledgerClosedAt: string;
  /** Contract that emitted the event */
  contractId: string;
  /** Discriminated event type */
  type: KoraEventType;
  /** On-chain token/invoice ID */
  tokenId: string;
  /** Amount involved (in human-readable units, divided by 1_000_000) */
  amount: number;
  /** Participant address (investor for funded/yield, SME for repaid) */
  participantAddress: string;
  /** Raw topic ScVals for debugging */
  rawTopics: string[];
}

/**
 * Parameters for `getContractEvents`.
 */
export interface GetContractEventsParams {
  contractId: string;
  eventTypes: KoraEventType[];
  /** Ledger sequence to start from (exclusive). Pass 0 to start from the latest. */
  startLedger: number;
}

/**
 * Result from `getContractEvents`.
 */
export interface GetContractEventsResult {
  events: ContractEvent[];
  /** The highest ledger sequence seen — use as `startLedger` for the next poll */
  latestLedger: number;
}

/**
 * Parse a raw Soroban event topic ScVal to a string.
 * Topics are typically Symbol or String ScVals.
 */
function parseTopicToString(val: StellarSdk.xdr.ScVal): string {
  try {
    if (val.switch().name === "scvSymbol") return val.sym().toString();
    if (val.switch().name === "scvString") return val.str().toString();
    if (val.switch().name === "scvAddress") {
      return StellarSdk.Address.fromScVal(val).toString();
    }
    if (val.switch().name === "scvU64") return val.u64().toString();
    if (val.switch().name === "scvI128") {
      return val.i128().lo().toString();
    }
    return val.toXDR("base64");
  } catch {
    return "";
  }
}

/**
 * Parse a raw Soroban event data ScVal to extract amount (i128) as a number.
 */
function parseAmountFromData(val: StellarSdk.xdr.ScVal): number {
  try {
    if (val.switch().name === "scvI128") {
      return Number(val.i128().lo().toString()) / 1_000_000;
    }
    if (val.switch().name === "scvU64") {
      return Number(val.u64().toString()) / 1_000_000;
    }
    // Map: look for "amount" key
    if (val.switch().name === "scvMap") {
      const map = val.map();
      if (map) {
        const entry = map.find((e) => {
          try { return e.key().sym().toString() === "amount"; } catch { return false; }
        });
        if (entry) return parseAmountFromData(entry.val());
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Parse a raw Soroban event data ScVal to extract a participant address.
 */
function parseAddressFromData(val: StellarSdk.xdr.ScVal): string {
  try {
    if (val.switch().name === "scvAddress") {
      return StellarSdk.Address.fromScVal(val).toString();
    }
    if (val.switch().name === "scvMap") {
      const map = val.map();
      if (map) {
        // Try common field names
        for (const key of ["investor", "owner", "participant", "from", "to"]) {
          const entry = map.find((e) => {
            try { return e.key().sym().toString() === key; } catch { return false; }
          });
          if (entry) {
            try {
              return StellarSdk.Address.fromScVal(entry.val()).toString();
            } catch { /* continue */ }
          }
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Parse a raw Soroban event data ScVal to extract a token/invoice ID.
 */
function parseTokenIdFromData(val: StellarSdk.xdr.ScVal): string {
  try {
    if (val.switch().name === "scvU64") return val.u64().toString();
    if (val.switch().name === "scvMap") {
      const map = val.map();
      if (map) {
        for (const key of ["token_id", "invoice_id", "id"]) {
          const entry = map.find((e) => {
            try { return e.key().sym().toString() === key; } catch { return false; }
          });
          if (entry) {
            try { return entry.val().u64().toString(); } catch { /* continue */ }
          }
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Fetch Soroban contract events from the RPC node.
 *
 * Polls `rpc.getEvents` for the given contract and event types starting from
 * `startLedger`. Returns parsed `ContractEvent[]` and the latest ledger seen.
 *
 * @param params - Contract ID, event types to filter, and cursor ledger
 */
export async function getContractEvents(
  params: GetContractEventsParams
): Promise<GetContractEventsResult> {
  const { contractId, eventTypes, startLedger } = params;

  // Build topic filters — each event type is a Symbol in topic[0]
  const filters: StellarSdk.rpc.Api.EventFilter[] = eventTypes.map((eventType) => ({
    type: "contract" as const,
    contractIds: [contractId],
    topics: [
      [StellarSdk.xdr.ScVal.scvSymbol(eventType).toXDR("base64")],
    ],
  }));

  const response = await rpc.getEvents({
    startLedger: startLedger > 0 ? startLedger : undefined,
    filters,
    limit: 100,
  });

  const latestLedger = response.latestLedger ?? startLedger;

  const events: ContractEvent[] = response.events
    .map((raw): ContractEvent | null => {
      try {
        // Decode topics
        const topics = raw.topic.map((t) => {
          const val = typeof t === "string" ? StellarSdk.xdr.ScVal.fromXDR(t, "base64") : (t as StellarSdk.xdr.ScVal);
          return parseTopicToString(val);
        });

        // topic[0] is the event name (Symbol)
        const eventName = topics[0] as KoraEventType;
        if (!eventTypes.includes(eventName)) return null;

        // Decode data payload
        const dataVal = typeof raw.value === "string" ? StellarSdk.xdr.ScVal.fromXDR(raw.value, "base64") : (raw.value as StellarSdk.xdr.ScVal);

        const tokenId = parseTokenIdFromData(dataVal) || topics[1] || "";
        const amount = parseAmountFromData(dataVal);
        const participantAddress = parseAddressFromData(dataVal) || topics[2] || "";

        return {
          id: raw.id,
          ledger: raw.ledger,
          ledgerClosedAt: raw.ledgerClosedAt,
          contractId: raw.contractId
            ? (typeof raw.contractId === "string"
                ? raw.contractId
                : (typeof (raw.contractId as any).contractId === "function"
                    ? (raw.contractId as any).contractId()
                    : String(raw.contractId)))
            : "",
          type: eventName,
          tokenId,
          amount,
          participantAddress,
          rawTopics: topics,
        };
      } catch {
        return null;
      }
    })
    .filter((e): e is ContractEvent => e !== null);

  return { events, latestLedger };
}

// ─── Contract event streaming ─────────────────────────────────────────────────

/** Preferred near-realtime cadence when using the stream loop (≤2s). */
export const EVENT_STREAM_INTERVAL_MS = 1_500;
/** Fallback polling cadence after stream failure. */
export const EVENT_POLL_FALLBACK_INTERVAL_MS = 5_000;
/** Consecutive stream failures before switching to polling fallback. */
export const EVENT_STREAM_FAILURE_THRESHOLD = 3;

export type EventSubscriptionMode = "stream" | "polling";

export interface SubscribeContractEventsParams extends GetContractEventsParams {
  /** Optional indexer/SSE endpoint. When set, EventSource is preferred. */
  streamUrl?: string;
  /** Interval for the RPC stream loop (default 1500ms). */
  streamIntervalMs?: number;
  /** Interval for polling fallback (default 5000ms). */
  pollIntervalMs?: number;
}

export interface ContractEventSubscription {
  /** Tear down SSE / timers. */
  unsubscribe: () => void;
  /** Current transport mode. */
  getMode: () => EventSubscriptionMode;
}

export interface ContractEventSubscriptionHandlers {
  onEvents: (result: GetContractEventsResult) => void;
  onModeChange?: (mode: EventSubscriptionMode) => void;
  onError?: (error: unknown) => void;
}

/**
 * Subscribe to contract events via indexer SSE when available, otherwise a
 * near-realtime RPC stream loop. Falls back to slower polling after repeated
 * stream failures so marketplace funding progress stays resilient.
 */
export function subscribeContractEvents(
  params: SubscribeContractEventsParams,
  handlers: ContractEventSubscriptionHandlers
): ContractEventSubscription {
  const {
    streamUrl = typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_EVENTS_STREAM_URL
      : undefined,
    streamIntervalMs = EVENT_STREAM_INTERVAL_MS,
    pollIntervalMs = EVENT_POLL_FALLBACK_INTERVAL_MS,
  } = params;

  let mode: EventSubscriptionMode = "stream";
  let stopped = false;
  let startLedger = params.startLedger;
  let failureCount = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let eventSource: EventSource | null = null;

  const setMode = (next: EventSubscriptionMode) => {
    if (mode === next) return;
    mode = next;
    handlers.onModeChange?.(next);
  };

  const clearTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const closeEventSource = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };

  const handleResult = (result: GetContractEventsResult) => {
    if (result.latestLedger > startLedger) {
      startLedger = result.latestLedger;
    }
    failureCount = 0;
    handlers.onEvents(result);
  };

  const pollOnce = async () => {
    if (stopped) return;
    try {
      const result = await getContractEvents({
        contractId: params.contractId,
        eventTypes: params.eventTypes,
        startLedger,
      });
      handleResult(result);
    } catch (err) {
      failureCount += 1;
      handlers.onError?.(err);
      if (mode === "stream" && failureCount >= EVENT_STREAM_FAILURE_THRESHOLD) {
        startPollingFallback();
      }
    }
  };

  const startPollingFallback = () => {
    if (stopped) return;
    closeEventSource();
    clearTimer();
    setMode("polling");
    failureCount = 0;
    void pollOnce();
    timer = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
  };

  const startRpcStreamLoop = () => {
    if (stopped) return;
    closeEventSource();
    clearTimer();
    setMode("stream");
    void pollOnce();
    timer = setInterval(() => {
      void pollOnce();
    }, streamIntervalMs);
  };

  const startSse = (url: string) => {
    if (typeof EventSource === "undefined") {
      startRpcStreamLoop();
      return;
    }

    try {
      const qs = new URL(url);
      qs.searchParams.set("contractId", params.contractId);
      qs.searchParams.set("eventTypes", params.eventTypes.join(","));
      if (startLedger > 0) qs.searchParams.set("startLedger", String(startLedger));

      eventSource = new EventSource(qs.toString());
      setMode("stream");

      eventSource.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as GetContractEventsResult;
          handleResult(parsed);
        } catch (err) {
          failureCount += 1;
          handlers.onError?.(err);
          if (failureCount >= EVENT_STREAM_FAILURE_THRESHOLD) {
            startPollingFallback();
          }
        }
      };

      eventSource.onerror = (err) => {
        failureCount += 1;
        handlers.onError?.(err);
        if (failureCount >= EVENT_STREAM_FAILURE_THRESHOLD) {
          startPollingFallback();
        }
      };
    } catch (err) {
      handlers.onError?.(err);
      startRpcStreamLoop();
    }
  };

  if (streamUrl) {
    startSse(streamUrl);
  } else {
    startRpcStreamLoop();
  }

  return {
    unsubscribe: () => {
      stopped = true;
      clearTimer();
      closeEventSource();
    },
    getMode: () => mode,
  };
}

// ─── Transaction submission ───────────────────────────────────────────────────

/** Error thrown when the network rejects a transaction due to a bad sequence number. */
export class BadSequenceError extends Error {
  constructor() {
    super("tx_bad_seq");
    this.name = "BadSequenceError";
  }
}

/** Returns true if a Soroban RPC send result represents a tx_bad_seq failure. */
export function isBadSeqResult(
  result: StellarSdk.rpc.Api.SendTransactionResponse
): boolean {
  if (result.status !== "ERROR") return false;
  // The error extras may contain result codes; check common shapes.
  const extras = (result as unknown as { errorResultXdr?: string; extras?: { result_codes?: { transaction?: string } } }).extras;
  const txCode = extras?.result_codes?.transaction ?? "";
  // Also check errorResultXdr for tx_bad_seq if present
  const xdr = (result as unknown as { errorResultXdr?: string }).errorResultXdr ?? "";
  return txCode === "tx_bad_seq" || xdr.includes("txBAD_SEQ");
}

/**
 * Submit a signed XDR transaction to the Soroban RPC.
 * Throws BadSequenceError when the network returns tx_bad_seq so the caller
 * can reset the sequence counter and retry.
 */
export async function submitTransaction(
  signedXdr: string
): Promise<StellarSdk.rpc.Api.SendTransactionResponse> {
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await rpc.sendTransaction(tx);

  if (isBadSeqResult(result)) {
    throw new BadSequenceError();
  }

  return result;
}

// ─── Batch invoice fetcher ────────────────────────────────────────────────────

/** Maximum invoices per batch request — hard cap to prevent RPC overload. */
export const BATCH_SIZE_LIMIT = 20;

export interface BatchInvoiceResult {
  tokenId: string;
  /** Resolved value on success, null on per-item failure. */
  data: import("@/types/contract").OnChainInvoice | null;
  error?: string;
}

/**
 * Fetch multiple on-chain invoices in a single "batch" by fanning out
 * parallel `get_invoice` simulations and settling all results.
 *
 * Soroban RPC does not have a true multi-call batch endpoint, so we fan out
 * concurrent `simulateTransaction` calls and collect them with
 * `Promise.allSettled` so one failure never aborts the rest.
 *
 * @param tokenIds  Array of on-chain token IDs (string representation of u64).
 * @param sourcePublicKey  Any funded account — used as the transaction source
 *                         for simulation (read-only, no signing required).
 * @param fetchInvoice  Injectable fetch function (defaults to real RPC call).
 *                      Accepts a tokenId string and returns OnChainInvoice.
 */
export async function batchGetInvoices(
  tokenIds: string[],
  sourcePublicKey: string,
  fetchInvoice?: (
    tokenId: string,
    source: string
  ) => Promise<import("@/types/contract").OnChainInvoice>
): Promise<BatchInvoiceResult[]> {
  // Enforce hard cap
  const ids = tokenIds.slice(0, BATCH_SIZE_LIMIT);

  const fetcher =
    fetchInvoice ??
    (async (tokenId: string, source: string) => {
      // Lazy import to avoid circular dependency at module parse time
      const { invoiceContract } = await import("./contracts");
      return invoiceContract.getInvoice(BigInt(tokenId), source);
    });

  const settled = await Promise.allSettled(
    ids.map((tokenId) => fetcher(tokenId, sourcePublicKey))
  );

  return settled.map((result, i) => {
    if (result.status === "fulfilled") {
      return { tokenId: ids[i], data: result.value };
    }
    return {
      tokenId: ids[i],
      data: null,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  });
}

/**
 * Poll for transaction confirmation.
 */
export async function waitForTransaction(
  hash: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<StellarSdk.rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await rpc.getTransaction(hash);
    if (result.status !== "NOT_FOUND") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${hash} not confirmed after ${maxAttempts} attempts`);
}

// ─── Transaction Details ──────────────────────────────────────────────────────

export interface TransactionDetails {
  hash: string;
  ledger: number;
  createdAt: string;
  feePaid: string; // in stroops
  feeXlm: number;
  successful: boolean;
  sourceAccount: string;
  operationCount: number;
  memo: string | null;
}

/**
 * Fetch full transaction details from Horizon by hash.
 * Uses NEXT_PUBLIC_STELLAR_HORIZON_URL — no hardcoded URLs.
 */
export async function fetchTransactionDetails(hash: string): Promise<TransactionDetails> {
  const tx = await withHorizonRetry(() => horizon.transactions().transaction(hash).call());
  return {
    hash: tx.hash,
    ledger: tx.ledger_attr,
    createdAt: tx.created_at,
    feePaid: String(tx.fee_charged),
    feeXlm: parseInt(String(tx.fee_charged), 10) / 10_000_000,
    successful: tx.successful,
    sourceAccount: tx.source_account,
    operationCount: tx.operation_count,
    memo: tx.memo ?? null,
  };
}

// ─── RPC Health Check ─────────────────────────────────────────────────────────

export interface RpcHealthResult {
  ok: boolean;
  latencyMs: number;
}

/**
 * Ping the Soroban RPC and return health status + latency.
 * Never throws — returns ok:false on error.
 */
export async function checkRpcHealth(): Promise<RpcHealthResult> {
  const start = Date.now();
  try {
    await Promise.race([
      rpc.getHealth(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5_000)),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}


