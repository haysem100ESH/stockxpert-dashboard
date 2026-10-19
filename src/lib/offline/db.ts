import Dexie, { type Table } from 'dexie';
import type { CatalogItem, LocalSale } from './types';

export class OfflineDatabase extends Dexie {
  catalog!: Table<CatalogItem, string>;
  sales!: Table<LocalSale, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  constructor(name = 'pharmaxpert-offline') {
    super(name);
    this.version(1).stores({
      catalog: 'id, branchId, ownerKey',
      sales: 'clientTxnId, status, branchId, userId, createdAt',
      meta: 'key',
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