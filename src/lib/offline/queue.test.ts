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
const { replaceCatalog } = await import('./catalog');

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear();
  await offlineDb.meta.put({ key: 'branches:user', value: ['branch'] });
  await offlineDb.catalog.put({ id: 'item', medicine_id: 'med', name: 'Medicine', branchId: 'branch', branch_id: 'branch', ownerKey: 'user',
    selling_price: 20, purchase_price: 10, stock_quantity: 12, serverAvailable: 12, packaging: null, cachedAt: '2026-10-19T08:00:00Z' });
});
afterAll(async () => { await offlineDb.delete(); });
describe('durable checkout transaction', () => {
  for (const status of ['pending', 'syncing', 'needs_attention'] as const) {
    test(`other-cashier ${status} reservation of 5 leaves 7 and prevents checkout above remainder`, async () => {
      const other = { ...sale(status, 'other-txn'), userId: 'other' };
      other.payload = { ...other.payload, items: [{ ...other.payload.items[0], base_quantity: 5 }] };
      await offlineDb.sales.add(other);
      // Same branch-scoped read used by the Sales inventory display, with no cashier filter.
      const shared = await offlineDb.sales.where('branchId').anyOf(['branch']).toArray();
      expect(availableStock(12, 'item', shared)).toBe(7);
      const current = sale('pending');
      current.payload = { ...current.payload, items: [{ ...current.payload.items[0], base_quantity: 8 }] };
      await expect(enqueueSale(current, true)).rejects.toThrow('Not enough sellable stock');
      expect(await offlineDb.sales.count()).toBe(1);
      current.payload.items[0].base_quantity = 7;
      await enqueueSale(current, true);
      expect(availableStock(12, 'item', await offlineDb.sales.where('branchId').equals('branch').toArray())).toBe(0);
      expect((await offlineDb.sales.get('other-txn'))?.payload).toEqual(other.payload);
    });
  }
  for (const status of ['discarded', 'synced', 'voided'] as const) {
    test(`other-cashier ${status} record does not reduce current cashier availability`, async () => {
      const other = { ...sale(status, 'other-txn'), userId: 'other' };
      other.payload = { ...other.payload, items: [{ ...other.payload.items[0], base_quantity: 5 }] };
      await offlineDb.sales.add(other);
      expect(availableStock(12, 'item', await offlineDb.sales.where('branchId').anyOf(['branch']).toArray())).toBe(12);
      const current = sale('pending');
      current.payload = { ...current.payload, items: [{ ...current.payload.items[0], base_quantity: 12 }] };
      await enqueueSale(current, true);
      expect(await offlineDb.sales.count()).toBe(2);
    });
  }
  test('other-cashier branch Y reservation does not affect branch X display or checkout', async () => {
    const other = { ...sale('pending', 'other-txn'), userId: 'other', branchId: 'branch-y' };
    other.payload = { ...other.payload, branch_id: 'branch-y', items: [{ ...other.payload.items[0], base_quantity: 5 }] };
    await offlineDb.sales.add(other);
    expect(availableStock(12, 'item', await offlineDb.sales.where('branchId').anyOf(['branch']).toArray())).toBe(12);
    const current = sale('pending');
    current.payload = { ...current.payload, items: [{ ...current.payload.items[0], base_quantity: 12 }] };
    await enqueueSale(current, true);
    expect(await offlineDb.sales.count()).toBe(2);
  });
  test('settled other-cashier sale and later server catalog refresh never double-subtract stock', async () => {
    const other = { ...sale('pending', 'other-txn'), userId: 'other' };
    other.payload = { ...other.payload, items: [{ ...other.payload.items[0], base_quantity: 5 }] };
    await offlineDb.sales.add(other);
    expect(availableStock(12, 'item', await offlineDb.sales.toArray())).toBe(7);
    await settleSale(other, { status: 'synced', sale_id: 'server-sale' });
    expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(7);
    expect(availableStock(7, 'item', await offlineDb.sales.toArray())).toBe(7);
    const snapshot = await offlineDb.catalog.get('item');
    if (!snapshot) throw new Error('Missing catalog snapshot');
    // Server snapshot already reflects the sale: replace rather than subtract again.
    await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog(['branch'], 'user', [{ ...snapshot, serverAvailable: 7 }]));
    expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(7);
    expect(availableStock(7, 'item', await offlineDb.sales.where('branchId').anyOf(['branch']).toArray())).toBe(7);
    expect((await offlineDb.sales.get('other-txn'))?.status).toBe('synced');
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