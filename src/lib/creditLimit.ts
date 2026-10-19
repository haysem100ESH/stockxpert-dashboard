/**
 * Per-customer credit cap interpretation.
 *
 * Storage uses the existing `customers.max_credit_limit` column with sentinels:
 *   - null            → "auto" — derive cap from credit score (default behaviour)
 *   - -1              → "unlimited" — no cap, sales always allowed on credit
 *   - any positive n  → "custom"   — fixed manual cap of n ETB
 */
import { getCreditLimit } from '@/hooks/useCreditScore';

export type CreditLimitMode = 'auto' | 'custom' | 'unlimited';

export const UNLIMITED_SENTINEL = -1;

export function getLimitMode(value: number | null | undefined): CreditLimitMode {
  if (value === null || value === undefined) return 'auto';
  if (value < 0) return 'unlimited';
  return 'custom';
}

/**
 * Resolve effective numeric limit. Returns Infinity for unlimited.
 * For "auto" you must pass creditScore.
 */
export function resolveCreditLimit(
  stored: number | null | undefined,
  creditScore: number,
): number {
  const mode = getLimitMode(stored);
  if (mode === 'unlimited') return Number.POSITIVE_INFINITY;
  if (mode === 'custom') return Number(stored);
  return getCreditLimit(creditScore);
}

export function formatLimit(limit: number): string {
  if (!isFinite(limit)) return 'Unlimited';
  return `ETB ${limit.toFixed(0)}`;
}
