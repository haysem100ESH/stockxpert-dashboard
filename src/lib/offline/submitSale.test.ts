import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, afterAll, expect, mock, test } from 'bun:test';
import { sale } from './rules.test';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
let reachable = true;
let response: { data: unknown; error: unknown } = { data: { status: 'synced', sale_id: 'server-id' }, error: null };
const calls: Array<{ payload: unknown; mode: string }> = [];
let effectCount = 0;
mock.module('./network', () => ({ checkReachability: async () => reachable, validSession: async () => true,
  withPosLock: async (work: () => Promise<unknown>) => work(),
  callPos: async (payload: unknown, mode: string) => { calls.push({ payload, mode }); return response; } }));
mock.module('./effects', () => ({ saleEffects: async (_sale: unknown, result: { duplicate?: boolean }) => { if (!result.duplicate) effectCount++; } }));
mock.module('./catalog', () => ({ fetchCatalog: async () => [], replaceCatalog: async () => {} }));
let storeState: Record<string, unknown> = {};
let backupSignals = 0;
mock.module('./store', () => ({ signalSync: () => {}, signalBackupNow: () => { backupSignals++; },
  getOfflineState: () => storeState, setOfflineState: (patch: Record<string, unknown>) => { storeState = { ...storeState, ...patch }; } }));
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const { offlineDb } = await import('./db');
const { submitSale } = await import('./submitSale');
const { syncSale } = await import('./syncSale');
beforeEach(async () => {
  calls.length = 0; effectCount = 0; reachable = true;
  response = { data: { status: 'synced', sale_id: 'server-id' }, error: null };
  await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear();
  await offlineDb.meta.put({ key: 'branches:user', value: ['branch'] });
  await offlineDb.catalog.put({ id: 'item', medicine_id: 'med', name: 'Medicine', branchId: 'branch', branch_id: 'branch', ownerKey: 'user',
    selling_price: 20, purchase_price: 10, stock_quantity: 12, serverAvailable: 12, packaging: null, cachedAt: '2026-10-19T08:00:00Z' });
});
afterAll(async () => { await offlineDb.delete(); });
test('online checkout calls atomic RPC exactly once', async () => {
  const record = sale('pending');
  expect((await submitSale(record.payload, 'user', record.summary)).status).toBe('synced');
  expect(calls).toEqual([{ payload: record.payload, mode: 'online' }]);
  expect((await offlineDb.sales.get('txn'))?.serverSaleId).toBe('server-id');
});
test('online rejection saves nothing and keeps retry ID available', async () => {
  response = { data: { status: 'rejected', reason_code: 'PRICE_CHANGED' }, error: null };
  const record = sale('pending');
  await expect(submitSale(record.payload, 'user', record.summary)).rejects.toThrow('price has changed');
  expect(await offlineDb.sales.count()).toBe(0);
});
test('unknown fully paid online result saves original payload and does not call RPC twice', async () => {
  response = { data: null, error: new Error('Timeout') };
  const record = sale('pending');
  expect((await submitSale(record.payload, 'user', record.summary)).status).toBe('saved');
  await submitSale(record.payload, 'user', record.summary);
  expect(calls.length).toBe(1);
  expect((await offlineDb.sales.get('txn'))?.payload).toEqual(record.payload);
  expect((await offlineDb.sales.get('txn'))?.mode).toBe('offline');
  const queued = await offlineDb.sales.get('txn');
  if (!queued) throw new Error('Missing queued sale');
  response = { data: { status: 'synced', duplicate: true, sale_id: 'server-id' }, error: null };
  await syncSale(queued);
  expect(calls[1]).toEqual({ payload: record.payload, mode: 'offline' });
});
test('unknown online credit result is queued in online mode with warning', async () => {
  response = { data: null, error: new Error('Timeout') };
  const record = sale('pending'); record.payload = { ...record.payload, amount_paid: 10, customer_id: 'customer' };
  const result = await submitSale(record.payload, 'user', record.summary, 50);
  expect(result.message).toContain('do not re-enter it');
  expect((await offlineDb.sales.get('txn'))?.mode).toBe('online');
  expect((await offlineDb.sales.get('txn'))?.payload.client_txn_id).toBe('txn');
  const queued = await offlineDb.sales.get('txn');
  if (!queued) throw new Error('Missing credit sale');
  response = { data: { status: 'synced', sale_id: 'server-id' }, error: null };
  await syncSale(queued);
  expect(calls[1]).toEqual({ payload: record.payload, mode: 'online' });
});
test('permanent checkout error still persists unchanged payload before returning', async () => {
  response = { data: null, error: { code: '23514', message: 'constraint failed' } };
  const record = sale('pending');
  const result = await submitSale(record.payload, 'user', record.summary);
  expect(result.message).toContain('server refused this attempt: constraint failed');
  const queued = await offlineDb.sales.get('txn');
  expect(queued?.payload).toEqual(record.payload);
  expect(queued?.status).toBe('pending');
  expect(queued?.lastError).toBe('constraint failed');
});
test('offline checkout commits locally without attempting RPC', async () => {
  reachable = false; const record = sale('pending');
  expect((await submitSale(record.payload, 'user', record.summary)).status).toBe('saved');
  expect(calls.length).toBe(0); expect((await offlineDb.sales.get('txn'))?.mode).toBe('offline');
});
test('duplicate server result never repeats post-sale effects', async () => {
  response = { data: { status: 'synced', sale_id: 'server-id', duplicate: true }, error: null };
  const record = sale('pending'); await submitSale(record.payload, 'user', record.summary);
  expect(effectCount).toBe(0);
});const { resetStorageSession, OFFLINE_BLOCKED_MESSAGE } = await import('./storageGuard');
function fakeStorage(persisted: boolean, quota: number) {
  Object.defineProperty(globalThis.navigator, 'storage', { configurable: true,
    value: { persisted: async () => persisted, persist: async () => persisted, estimate: async () => ({ quota, usage: 1 }) } });
}
test('private-like window blocks offline checkout and keeps nothing', async () => {
  fakeStorage(false, 100 * 1024 * 1024); resetStorageSession(); storeState = {};
  reachable = false; const record = sale('pending');
  await expect(submitSale(record.payload, 'user', record.summary)).rejects.toThrow(OFFLINE_BLOCKED_MESSAGE);
  expect(await offlineDb.sales.count()).toBe(0);
});
test('unusable IndexedDB (storageError) blocks offline checkout', async () => {
  fakeStorage(true, 10e9); resetStorageSession(); storeState = { storageError: 'Local storage is unavailable.' };
  reachable = false; const record = sale('pending');
  await expect(submitSale(record.payload, 'user', record.summary)).rejects.toThrow(OFFLINE_BLOCKED_MESSAGE);
});
test('online checkout is unaffected by a private-like window', async () => {
  fakeStorage(false, 100 * 1024 * 1024); resetStorageSession(); storeState = {};
  const record = sale('pending');
  expect((await submitSale(record.payload, 'user', record.summary)).status).toBe('synced');
});
test('not persisted but large quota still allows offline save and flushes backup', async () => {
  fakeStorage(false, 10e9); resetStorageSession(); storeState = {}; backupSignals = 0;
  reachable = false; const record = sale('pending');
  expect((await submitSale(record.payload, 'user', record.summary)).status).toBe('saved');
  expect(backupSignals).toBe(1);
});
