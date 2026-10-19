import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, afterAll, describe, expect, test } from 'bun:test';
import { sale } from './rules.test';
import { availableStock } from './rules';

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
const { offlineDb } = await import('./db');
const { enqueueSale, settleSale } = await import('./queue');

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear();
  await offlineDb.meta.put({ key: 'branches:user', value: ['branch'] });
  await offlineDb.catalog.put({ id: 'item', medicine_id: 'med', name: 'Medicine', branchId: 'branch', branch_id: 'branch', ownerKey: 'user',
    selling_price: 20, purchase_price: 10, stock_quantity: 12, serverAvailable: 12, packaging: null, cachedAt: '2026-10-19T08:00:00Z' });
});
afterAll(async () => { await offlineDb.delete(); });
describe('durable checkout transaction', () => {
  test('other-cashier reservations in the same branch do not prevent current cashier checkout', async () => {
    const other = { ...sale('pending', 'other-txn'), userId: 'other' };
    other.payload = { ...other.payload, items: [{ ...other.payload.items[0], base_quantity: 12 }] };
    await offlineDb.sales.add(other);
    await enqueueSale(sale('pending'), true);
    const own = await offlineDb.sales.where('userId').equals('user').toArray();
    expect(availableStock(12, 'item', own)).toBe(10);
    expect((await offlineDb.sales.get('other-txn'))?.payload).toEqual(other.payload);
  });
  test('committed sale reserves stock and survives reopen', async () => {
    await enqueueSale(sale('pending'), true); offlineDb.close(); await offlineDb.open();
    const item = await offlineDb.catalog.get('item');
    expect(availableStock(item?.serverAvailable ?? 0, 'item', await offlineDb.sales.toArray())).toBe(10);
  });
  test('repeated transaction ID creates only one local sale', async () => {
    await enqueueSale(sale('pending'), true); await enqueueSale(sale('pending'), true); expect(await offlineDb.sales.count()).toBe(1);
  });
  test('aggregate lines cannot oversell local available stock', async () => {
    const record = sale('pending'); record.payload = { ...record.payload, items: [{ ...record.payload.items[0], base_quantity: 7 }, { ...record.payload.items[0], base_quantity: 7 }] };
    await expect(enqueueSale(record, true)).rejects.toThrow('Not enough sellable stock'); expect(await offlineDb.sales.count()).toBe(0);
  });
  test('offline underpaid sale saves nothing', async () => {
    const record = sale('pending'); record.payload = { ...record.payload, amount_paid: 19 };
    await expect(enqueueSale(record, true)).rejects.toThrow('fully paid'); expect(await offlineDb.sales.count()).toBe(0);
  });
  test('offline debt deduction saves nothing', async () => {
    const record = sale('pending'); record.payload = { ...record.payload, deduct_debt_amount: 1 };
    await expect(enqueueSale(record, true)).rejects.toThrow('fully paid'); expect(await offlineDb.sales.count()).toBe(0);
  });
  test('unknown online credit outcome keeps original mode and ID', async () => {
    const record = sale('pending'); record.mode = 'online'; record.payload = { ...record.payload, amount_paid: 10 };
    await enqueueSale(record, false);
    expect((await offlineDb.sales.get('txn'))?.mode).toBe('online'); expect((await offlineDb.sales.get('txn'))?.payload.client_txn_id).toBe('txn');
  });
  test('server attention preserves reservation and issue details', async () => {
    const record = sale('pending'); await enqueueSale(record, true);
    await settleSale(record, { status: 'needs_attention', reason_code: 'PRICE_CHANGED', issue_id: 'issue', reason_detail: { current_unit_price: 25 } });
    expect((await offlineDb.sales.get('txn'))?.issueId).toBe('issue'); expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(10);
  });
  test('server void releases reservation', async () => {
    const record = sale('pending'); await enqueueSale(record, true); await settleSale(record, { status: 'voided', issue_id: 'issue' });
    expect((await offlineDb.sales.get('txn'))?.status).toBe('voided'); expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(12);
  });
  test('sync atomically moves reservation into snapshot without stock jump', async () => {
    const record = sale('pending'); await enqueueSale(record, true); await settleSale(record, { status: 'synced', sale_id: 'server-sale', duplicate: true });
    expect((await offlineDb.sales.get('txn'))?.serverSaleId).toBe('server-sale');
    expect(availableStock((await offlineDb.catalog.get('item'))?.serverAvailable ?? 0, 'item', await offlineDb.sales.toArray())).toBe(10);
  });
  test('settling the same confirmed transaction twice does not subtract stock twice', async () => {
    const record = sale('pending'); await enqueueSale(record, true);
    await settleSale(record, { status: 'synced', sale_id: 'server-sale' });
    await settleSale(record, { status: 'synced', sale_id: 'server-sale', duplicate: true });
    expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(10);
    expect(await offlineDb.sales.count()).toBe(1);
  });
});