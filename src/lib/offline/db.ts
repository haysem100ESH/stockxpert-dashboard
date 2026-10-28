import Dexie, { type Table } from 'dexie';
import type { CatalogItem, LocalSale } from './types';
import type { ReadCacheEntry } from './readCache';

export class OfflineDatabase extends Dexie {
  declare catalog: Table<CatalogItem, string>;
  declare sales: Table<LocalSale, string>;
  declare meta: Table<{ key: string; value: unknown }, string>;
  declare readCache: Table<ReadCacheEntry, [string, string, string]>;
  constructor(name = 'pharmaxpert-offline') {
    super(name);
    this.version(1).stores({
      catalog: 'id, branchId, ownerKey',
      sales: 'clientTxnId, status, branchId, userId, createdAt',
      meta: 'key',
    });
    // Version 2 adds optional discard audit fields; keys and indexes are unchanged.
    this.version(2).stores({
      catalog: 'id, branchId, ownerKey',
      sales: 'clientTxnId, status, branchId, userId, createdAt',
      meta: 'key',
    });
    // Version 3 adds the per-user offline read cache for in-scope pages.
    this.version(3).stores({
      catalog: 'id, branchId, ownerKey',
      sales: 'clientTxnId, status, branchId, userId, createdAt',
      meta: 'key',
      readCache: '[userId+scopeKey+queryKey], userId, [userId+path]',
    });
  }
}
export const offlineDb = new OfflineDatabase();
export async function readMeta<T>(key: string): Promise<T | undefined> {
  return (await offlineDb.meta.get(key))?.value as T | undefined;
}
export async function writeMeta(key: string, value: unknown): Promise<void> {
  await offlineDb.meta.put({ key, value });
}
export async function cacheMeta(key: string, value: unknown): Promise<void> {
  // Access to the online app must not fail if this device refuses local storage.
  try { await writeMeta(key, value); } catch { /* Offline startup will stay blocked. */ }
}