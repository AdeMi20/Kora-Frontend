/**
 * In-memory registry of wallet addresses that completed the
 * /api/auth/challenge -> /api/auth/verify signature flow, keyed by address
 * with the session's expiry. Upload token verification consults this so
 * pinning can only be authorized for a wallet that actually proved
 * ownership through the challenge flow (Issue #275 follow-up).
 *
 * Note: single-instance in-memory store, same limitation as the existing
 * upload rate limiter — use a shared store (Redis) for multi-instance deploys.
 * See docs/architecture.md#redis-migration-for-rate-limiting-and-shared-state.
 */

const verifiedWallets = new Map<string, number>(); // walletAddress -> expiresAt (ms)

export function markWalletVerified(walletAddress: string, expiresAt: number): void {
  verifiedWallets.set(walletAddress, expiresAt);
}

export function isWalletVerified(walletAddress: string): boolean {
  const expiresAt = verifiedWallets.get(walletAddress);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    verifiedWallets.delete(walletAddress);
    return false;
  }
  return true;
}
