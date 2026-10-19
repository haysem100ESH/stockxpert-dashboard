import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, afterAll, expect, test } from 'bun:test';
import { sale } from './rules.test';
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
const { offlineDb } = await import('./db');
const { clearUserDeviceData, exportDocument, exportFingerprint, retryUserSales } = await import('./deviceSafety');
beforeEach(async () => { await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear(); });
afterAll(async () => { await offlineDb.delete(); });
test('export includes all three unresolved states, full payloads, and no other user or auth fields', () => {
  const records = [sale('pending', 'a'), sale('syncing', 'b'), sale('needs_attention', 'c'), sale('synced', 'd'), sale('voided', 'e'), { ...sale('pending', 'f'), userId: 'other' }];
  Object.assign(records[0], { access_token: 'not-exported', password: 'not-exported' });
  const result = exportDocument(records, 'user');
  expect(result.sales.map(r => r.clientTxnId)).toEqual(['a', 'b', 'c']);
  expect(result.sales[0].payload).toEqual(records[0].payload);
  expect(JSON.stringify(result)).not.toContain('not-exported');
});
for (const state of ['pending', 'syncing', 'needs_attention'] as const) {
  test(`${state} blocks cleanup without export`, async () => {
    await offlineDb.sales.add(sale(state));
    await expect(clearUserDeviceData('user')).rejects.toThrow('Export');
    expect(await offlineDb.sales.count()).toBe(1);
  });
}
test('new sale invalidates a previous export', async () => {
  const record = sale('pending'); await offlineDb.sales.add(record);
  const exported = exportFingerprint([record]); await offlineDb.sales.add(sale('pending', 'new'));
  await expect(clearUserDeviceData('user', exported)).rejects.toThrow('Export');
  expect(await offlineDb.sales.count()).toBe(2);
});
test('exported cleanup removes only departing user sales, catalog and metadata', async () => {
  const record = sale('pending'); await offlineDb.sales.bulkAdd([record, { ...sale('pending', 'other-txn'), userId: 'other' }]);
  await offlineDb.catalog.bulkPut([{ id: 'own', ownerKey: 'user' }, { id: 'other', ownerKey: 'other' }] as any);
  await offlineDb.meta.bulkPut([{ key: 'profile:user', value: {} }, { key: 'catalogSync:user:branch', value: 'date' }, { key: 'profile:other', value: {} }]);
  await clearUserDeviceData('user', exportFingerprint([record]));
  expect((await offlineDb.sales.toArray()).map(r => r.userId)).toEqual(['other']);
  expect((await offlineDb.catalog.toArray()).map(r => r.id)).toEqual(['other']);
  expect((await offlineDb.meta.toArray()).map(r => r.key)).toEqual(['profile:other']);
});
test('no unresolved records permits cleanup without export', async () => {
  await offlineDb.sales.add(sale('synced')); await offlineDb.meta.put({ key: 'profile:user', value: {} });
  await clearUserDeviceData('user'); expect(await offlineDb.meta.count()).toBe(0); expect(await offlineDb.sales.count()).toBe(0);
});
test('retry now changes only this user pending record deadline', async () => {
  await offlineDb.sales.bulkAdd([{ ...sale('pending'), nextAttemptAt: Date.now() + 300000 }, sale('needs_attention', 'attention'), { ...sale('pending', 'other'), userId: 'other', nextAttemptAt: 123 }]);
  await retryUserSales('user');
  expect((await offlineDb.sales.get('txn'))?.nextAttemptAt).toBeLessThanOrEqual(Date.now());
  expect((await offlineDb.sales.get('other'))?.nextAttemptAt).toBe(123);
  expect((await offlineDb.sales.get('attention'))?.status).toBe('needs_attention');
});