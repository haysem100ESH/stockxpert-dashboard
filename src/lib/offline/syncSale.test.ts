import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, expect, test } from 'bun:test';
import { sale } from './rules.test';
import { offlineDb } from './db';
import { syncSale } from './syncSale';
import { availableStock } from './rules';
import { recoverUserQueue } from './queue';
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
beforeEach(async () => { await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear(); });
test('same-user sign-in recovers interrupted syncing and sends unchanged stored payload only for that cashier', async () => {
  const record = { ...sale('syncing'), nextAttemptAt: Date.now() + 300000 };
  await offlineDb.sales.bulkAdd([record, { ...sale('syncing', 'other-txn'), userId: 'other' }]);
  await offlineDb.meta.put({ key: 'catalogSync:user:branch', value: 'cached-time' });
  await offlineDb.catalog.put({ id: 'item', ownerKey: 'user', serverAvailable: 12 } as any);
  await recoverUserQueue('user');
  const recovered = await offlineDb.sales.get(record.clientTxnId);
  if (!recovered) throw new Error('Missing retained sale');
  expect(recovered.status).toBe('pending');
  expect(recovered.nextAttemptAt).toBeLessThanOrEqual(Date.now());
  expect((await offlineDb.sales.get('other-txn'))?.status).toBe('syncing');
  expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(12);
  expect((await offlineDb.meta.get('catalogSync:user:branch'))?.value).toBe('cached-time');
  await syncSale(recovered, { sessionValid: async () => true, call: async (payload, mode) => {
    expect(JSON.stringify(payload)).toBe(JSON.stringify(record.payload)); expect(mode).toBe('offline');
    return { data: { status: 'synced', sale_id: 'server-id', duplicate: true }, error: null };
  } });
  expect((await offlineDb.sales.get(record.clientTxnId))?.status).toBe('synced');
  expect((await offlineDb.sales.get('other-txn'))?.status).toBe('syncing');
});
test('legacy online-mode fully paid record retries offline with byte-identical payload', async () => {
  const record = { ...sale('pending'), mode: 'online' as const };
  await offlineDb.sales.add(record);
  const original = JSON.stringify(record.payload);
  let usedMode = '';
  await syncSale(record, { sessionValid: async () => true, call: async (payload, mode) => {
    usedMode = mode; expect(JSON.stringify(payload)).toBe(original);
    return { data: { status: 'rejected', reason_code: 'USER_NOT_ALLOWED_TO_SELL' }, error: null };
  } });
  expect(usedMode).toBe('offline');
  const refused = await offlineDb.sales.get(record.clientTxnId);
  expect(refused?.status).toBe('needs_attention');
  expect(refused?.issueId).toBeUndefined();
  expect(JSON.stringify(refused?.payload)).toBe(original);
  expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(10);
});
for (const payment of [{ amount_paid: 10, deduct_debt_amount: 0 }, { amount_paid: 20, deduct_debt_amount: 1 }]) {
  test(`credit retry stays online (${JSON.stringify(payment)})`, async () => {
    const record = sale('pending'); record.payload = { ...record.payload, ...payment };
    await offlineDb.sales.add(record);
    await syncSale(record, { sessionValid: async () => true, call: async (payload, mode) => {
      expect(mode).toBe('online'); expect(payload).toEqual(record.payload);
      return { data: { status: 'rejected', reason_code: 'INVALID_PAYMENT' }, error: null };
    } });
    expect((await offlineDb.sales.get('txn'))?.status).toBe('needs_attention');
    expect((await offlineDb.sales.get('txn'))?.issueId).toBeUndefined();
  });
}
for (const [code, valid, permanent] of [
  ['22P02', true, true], ['23505', true, true], ['42501', true, true],
  ['28000', true, true], ['28000', false, false], ['PGRST301', true, false],
  ['40001', true, false], ['40P01', true, false], ['57014', true, false],
  [undefined, true, false],
] as const) {
  test(`background ${code ?? 'network'} error has ${permanent ? 'review' : 'backoff'} outcome (session ${valid})`, async () => {
    const record = sale('pending'); await offlineDb.sales.add(record);
    await syncSale(record, { sessionValid: async () => valid, call: async () => ({ data: null, error: { code, message: 'Exact server error' } }) });
    const saved = await offlineDb.sales.get('txn');
    expect(saved?.status).toBe(permanent ? 'needs_attention' : 'pending');
    expect(saved?.issueId).toBeUndefined();
    expect(saved?.lastError).toBe('Exact server error');
    expect(saved?.reasonCode).toBe(permanent ? code : undefined);
    expect(saved?.payload).toEqual(record.payload);
    expect(saved?.attempts).toBe(1);
    if (permanent) expect(saved?.nextAttemptAt).toBeUndefined();
    else expect(saved?.nextAttemptAt).toBeGreaterThan(Date.now());
  });
}