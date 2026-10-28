import { readMeta } from './db';
import { cachedScopes } from './readCache';
import type { CachedBranch } from './catalog';

/** Offline gates fail closed: only values verified online on this PC are used. */
export const OPEN_ONCE_ONLINE = 'Open this page once while online on this PC.';
export type CachedSubscription = { status: 'active' | 'expiring_soon' | 'expired' | 'inactive'; credit: number };

export async function loadOfflineSubscription(userId: string): Promise<{ status: CachedSubscription['status'] | 'uncached'; credit: number }> {
  const cached = await readMeta<CachedSubscription>(`subscription:${userId}`).catch(() => undefined);
  return cached ? { status: cached.status, credit: cached.credit ?? 0 } : { status: 'uncached', credit: 0 };
}
export async function loadOfflinePermissions<T>(userId: string, denied: T): Promise<{ permissions: T; uncached: boolean }> {
  const cached = await readMeta<T>(`permissions:${userId}`).catch(() => undefined);
  return cached ? { permissions: cached, uncached: false } : { permissions: denied, uncached: true };
}
export interface OfflineBranchOption extends CachedBranch { available: boolean }
/** Owners offline: list only allowed branches; a branch is selectable only if its data was cached. */
export async function loadOfflineBranches(userId: string): Promise<{ branches: OfflineBranchOption[]; allAvailable: boolean; uncached: boolean }> {
  const [details, allowed, scopes] = await Promise.all([
    readMeta<CachedBranch[]>(`branchDetails:${userId}`).catch(() => undefined),
    readMeta<string[]>(`branches:${userId}`).catch(() => undefined),
    cachedScopes(userId).catch(() => new Set<string>()),
  ]);
  if (!details || !allowed) return { branches: [], allAvailable: false, uncached: true };
  return {
    branches: details.filter(b => allowed.includes(b.id)).map(b => ({ ...b, available: scopes.has(b.id) })),
    allAvailable: scopes.has('owner-all'), uncached: false,
  };
}
