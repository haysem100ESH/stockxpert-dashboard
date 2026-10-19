import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, afterAll, expect, test } from 'bun:test';
import { sale } from './rules.test';
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
const { offlineDb } = await import('./db');
const { clearUserDeviceData, exportDocument, exportFingerprint, retryUserSales, discardUserSale } = await import('./deviceSafety');
const { settleSale } = await import('./queue');
const { availableStock } = await import('./rules');
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
for (const state of ['pending', 'syncing', 'needs_attention', 'discarded'] as const) {
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
test('server rejection reserves stock; discard requires note, audits, exports and gates cleanup', async () => {
  const record = sale('pending');
  await offlineDb.sales.add(record);
  await settleSale(record, { status: 'rejected', reason_code: 'BRANCH_NOT_AUTHORIZED' });
  const refused = await offlineDb.sales.get('txn');
  expect(refused?.status).toBe('needs_attention');
  expect(refused?.issueId).toBeUndefined();
  expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(10);
  const oldExport = exportFingerprint(await offlineDb.sales.toArray());
  await expect(discardUserSale('user', 'txn', '  ')).rejects.toThrow('note');
  expect((await offlineDb.sales.get('txn'))?.status).toBe('needs_attention');
  await discardUserSale('user', 'txn', '  Refused sale reviewed  ');
  const discarded = await offlineDb.sales.get('txn');
  expect(discarded?.status).toBe('discarded');
  expect(discarded?.discardNote).toBe('Refused sale reviewed');
  expect(discarded?.discardedBy).toBe('user');
  expect(Number.isFinite(Date.parse(discarded?.discardedAt ?? ''))).toBe(true);
  expect(discarded?.payload).toEqual(record.payload);
  expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(12);
  const records = await offlineDb.sales.toArray();
  expect(exportDocument(records, 'user').sales[0].discardNote).toBe('Refused sale reviewed');
  await expect(clearUserDeviceData('user')).rejects.toThrow('Export');
  await expect(clearUserDeviceData('user', oldExport)).rejects.toThrow('Export');
  await retryUserSales('user', 'txn');
  expect((await offlineDb.sales.get('txn'))?.status).toBe('discarded');
  await clearUserDeviceData('user', exportFingerprint(records));
  expect(await offlineDb.sales.count()).toBe(0);
});
test('device-only Retry resets scheduling and preserves original transaction and payload', async () => {
  const record = { ...sale('needs_attention'), attempts: 7, nextAttemptAt: Date.now() + 300000 };
  await offlineDb.sales.add(record);
  await retryUserSales('user', 'txn');
  const retried = await offlineDb.sales.get('txn');
  expect(retried?.status).toBe('pending');
  expect(retried?.attempts).toBe(0);
  expect(retried?.nextAttemptAt).toBeLessThanOrEqual(Date.now());
  expect(retried?.clientTxnId).toBe(record.clientTxnId);
  expect(retried?.payload).toEqual(record.payload);
});
test('server-owned issues and other users cannot be discarded or manually retried', async () => {
  await offlineDb.sales.add({ ...sale('needs_attention'), issueId: 'issue' });
  await expect(discardUserSale('user', 'txn', 'Note')).rejects.toThrow('device-only');
  await retryUserSales('user', 'txn');
  expect((await offlineDb.sales.get('txn'))?.status).toBe('needs_attention');
  await offlineDb.sales.put(sale('needs_attention'));
  await expect(discardUserSale('other', 'txn', 'Note')).rejects.toThrow('device-only');
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