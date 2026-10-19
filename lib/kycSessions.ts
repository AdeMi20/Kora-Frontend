/**
 * In-memory registry of KYC status by wallet address — Issue #694.
 *
 * The Synaps webhook is the only writer; `GET /api/webhooks/kyc` is the only
 * reader. The client polls that endpoint so a completed verification reaches
 * the wallet KYC tab without a hard refresh.
 *
 * Note: single-instance in-memory store, the same limitation as
 * `lib/verifiedSessions.ts` and the upload rate limiter — a multi-instance
 * deploy needs a shared store (Redis) or a real user record.
 * See docs/architecture.md#redis-migration-for-rate-limiting-and-shared-state.
 */

import type { KycStatus } from "@/lib/kycWebhook";

export interface KycRecord {
  status: KycStatus;
  /** Synaps session that produced this status. */
  sessionId: string;
  /** Epoch ms the record was written. */
  updatedAt: number;
}

const kycByWallet = new Map<string, KycRecord>();

/**
 * Record a KYC status for a wallet.
 *
 * Out-of-order delivery is real: Synaps retries, and a `SUBMITTED` retry can
 * land after the `APPROVED` that followed it. Writes older than the stored
 * record are ignored so a retry cannot walk a verified investor backwards.
 */
export function setKycStatus(
  walletAddress: string,
  status: KycStatus,
  sessionId: string,
  updatedAt: number = Date.now()
): KycRecord {
  const existing = kycByWallet.get(walletAddress);
  if (existing && existing.updatedAt > updatedAt) return existing;

  const record: KycRecord = { status, sessionId, updatedAt };
  kycByWallet.set(walletAddress, record);
  return record;
}

export function getKycStatus(walletAddress: string): KycRecord | null {
  return kycByWallet.get(walletAddress) ?? null;
}

/** Test seam — the registry is process-global and would otherwise leak between suites. */
export function clearKycStatuses(): void {
  kycByWallet.clear();
}
