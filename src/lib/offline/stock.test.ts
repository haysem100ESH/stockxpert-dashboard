import { beforeEach, afterAll, expect, mock, test } from 'bun:test';
mock.module('./network', () => ({
  withPosLock: (work: () => Promise<unknown>) => new Promise((resolve, reject) => setTimeout(() => { work().then(resolve, reject); }, 0)),
  validSession: async () => true, checkReachability: async () => true,
  callPos: async () => ({ data: null, error: new Error('Not configured') }),
}));
const { offlineDb } = await import('./db');
const { enqueueOp, canEnqueueOp } = await import('./ops');
const { syncOp, settleOp } = await import('./syncOp');
const { stockPayload, stockDelta, stockOnDevice, overlayBatches, stockContext, batchAvailableOnDevice } = await import('./stock');
const { opReason, ownerForceLabel } = await import('./opTypes');
import type { OpResult } from './opTypes';
const { buildBackupDocument } = await import('./backup');
const { parseBackup, restoreBackup } = await import('./restore');
const { pendingOpActivityRows } = await import('./activity');
const { saveReadEntry, describeRequest, readCachedResponse } = await import('./readCache');
import type { LocalSale } from './types';

const DEVICE_DAY = '2026-10-29';
beforeEach(async () => {
  await offlineDb.open();
  await Promise.all([offlineDb.ops.clear(), offlineDb.sales.clear(), offlineDb.meta.clear(), offlineDb.readCache.clear(), offlineDb.catalog.clear()]);
  await offlineDb.meta.bulkPut([
    { key: 'profile:user', value: { id: 'user', role: 'staff', active: true } },
    { key: 'branches:user', value: ['branch'] }, { key: 'subscription:user', value: { status: 'active' } },
    { key: 'permissions:user', value: { customers: 'edit', suppliers: 'edit', inventory: 'edit' } },
  ]);
  await offlineDb.catalog.put({ id: 'item', branchId: 'branch', ownerKey: 'user', medicine_id: 'med',
    quantity: 10, serverAvailable: 10, batches: [], cachedAt: DEVICE_DAY } as never);
});
afterAll(async () => { await offlineDb.delete(); });

const sale = (clientTxnId: string, userId: string, base: number, status: LocalSale['status'] = 'pending'): LocalSale => ({
  clientTxnId, branchId: 'branch', userId, mode: 'offline', status, attempts: 0,
  payload: { client_txn_id: clientTxnId, branch_id: 'branch', sale_date: DEVICE_DAY, device_created_at: `${DEVICE_DAY}T10:00:00Z`,
    payment_method: 'cash', discount_amount: 0, total_amount: base, amount_paid: base, change_action: null, extra_profit: 0,
    customer_id: null, deduct_debt_amount: 0, items: [{ branch_item_id: 'item', medicine_id: 'med', sale_type: 'unit', level_flow: false,
      quantity: base, unit_price: 1, total_price: base, base_quantity: base, strip_quantity: 0, pack_quantity: 0, stripes_sold: 0 }] },
  summary: { items: [], total: base }, createdAt: `${DEVICE_DAY}T10:00:00Z`, updatedAt: `${DEVICE_DAY}T10:00:00Z`,
});
const receive = (opId: string, values: Record<string, unknown>, userId = 'user') =>
  enqueueOp({ userId, branchId: 'branch', opType: 'stock.receive', opId, entityId: `batch-${opId}`, values: { branch_item_id: 'item', ...values } });
const applied = (opId: string): OpResult => ({ status: 'applied', updated_at: '2026-10-29T12:00:00Z', op_id: opId, branch_item_id: 'item' });

test('receive keeps only allowed fields and requires quantity and selling price', async () => {
  const op = await receive('r1', { quantity: 5, selling_price: 12, purchase_price: 8, expiry_date: '2027-01-01', batch_number: 'B1',
    supplier_id: 'sup', min_stock_level: 2, expiry_alert_days: 30, evil: 'drop', total_cost: 999, payment_type: 'credit' });
  expect(op.payload).toEqual({ branch_item_id: 'item', quantity: 5, selling_price: 12, purchase_price: 8, expiry_date: '2027-01-01',
    batch_number: 'B1', supplier_id: 'sup', min_stock_level: 2, expiry_alert_days: 30 });
  await expect(receive('r2', { selling_price: 12 })).rejects.toThrow('quantity');
  await expect(receive('r3', { quantity: 5 })).rejects.toThrow('selling_price');
  await expect(receive('r4', { quantity: 0, selling_price: 12 })).rejects.toThrow('quantity');
});

test('validation mirrors server including Addis device-date expiry', async () => {
  expect(() => stockPayload('stock.receive', { branch_item_id: 'item', quantity: 5, selling_price: 12, expiry_date: '2026-10-28' }, DEVICE_DAY)).toThrow('Addis');
  expect(() => stockPayload('stock.receive', { branch_item_id: 'item', quantity: 5, selling_price: 12, expiry_date: DEVICE_DAY }, DEVICE_DAY)).not.toThrow();
  expect(() => stockPayload('stock.receive', { branch_item_id: 'item', quantity: 5, selling_price: 12, expiry_date: '2026-02-30' }, DEVICE_DAY)).toThrow();
  expect(() => stockPayload('stock.receive', { branch_item_id: 'item', quantity: 5, selling_price: 12, expiry_alert_days: 1.5 }, DEVICE_DAY)).toThrow('whole number');
  expect(() => stockPayload('stock.adjust', { batch_id: 'b', branch_item_id: 'item', delta: -1, reason_type: 'damage' }, DEVICE_DAY)).toThrow('one batch');
  expect(() => stockPayload('stock.adjust', { branch_item_id: 'item', delta: 0, reason_type: 'damage' }, DEVICE_DAY)).toThrow('non-zero');
  expect(() => stockPayload('stock.adjust', { branch_item_id: 'item', delta: 3, reason_type: 'damage' }, DEVICE_DAY)).toThrow('decrease');
  expect(() => stockPayload('stock.adjust', { branch_item_id: 'item', delta: 3, reason_type: 'count_correction' }, DEVICE_DAY)).toThrow('note');
  expect(() => stockPayload('stock.adjust', { branch_item_id: 'item', delta: 3, reason_type: 'other', note: 'recount' }, DEVICE_DAY)).not.toThrow();
});

test('receive on an offline supplier depends on it and is blocked while the supplier needs attention', async () => {
  const supplier = await enqueueOp({ userId: 'user', branchId: 'branch', opType: 'supplier.create', opId: 'sup-op', entityId: 'sup-local', values: { name: 'New Supplier' } });
  const op = await receive('r5', { quantity: 5, selling_price: 12, supplier_id: 'sup-local' });
  expect(op.dependsOn).toContain(supplier.opId);
  let sent = 0;
  const deps = { call: async () => { sent++; return { data: applied(op.opId), error: null }; }, sessionValid: async () => true };
  await syncOp(op, deps); expect(sent).toBe(0);
  expect(await offlineDb.ops.get(op.opId)).toMatchObject({ status: 'pending' });
  await offlineDb.ops.update(supplier.opId, { status: 'needs_attention' });
  await syncOp((await offlineDb.ops.get(op.opId))!, deps);
  expect(sent).toBe(0);
  expect(await offlineDb.ops.get(op.opId)).toMatchObject({ status: 'needs_attention', reasonCode: 'DEPENDS_ON_UNSYNCED' });
  await settleOp(supplier, { status: 'applied', updated_at: '2026-10-29T12:00:00Z' });
  await syncOp((await offlineDb.ops.get(op.opId))!, deps);
  expect(sent).toBe(1);
});

test('adjustment on an offline-received batch depends on the receipt and validates against device stock', async () => {
  const receipt = await receive('r6', { quantity: 5, selling_price: 12 });
  const adjust = await enqueueOp({ userId: 'user', branchId: 'branch', opType: 'stock.adjust', opId: 'a1', entityId: receipt.entityId,
    values: { batch_id: receipt.entityId, branch_item_id: 'item', delta: -2, reason_type: 'damage' } });
  expect(adjust.dependsOn).toContain(receipt.opId);
  await expect(enqueueOp({ userId: 'user', branchId: 'branch', opType: 'stock.adjust', opId: 'a2', entityId: receipt.entityId,
    values: { batch_id: receipt.entityId, branch_item_id: 'item', delta: -6, reason_type: 'damage' } })).rejects.toThrow('Not enough stock');
  let sent = 0;
  const deps = { call: async () => { sent++; return { data: applied(adjust.opId), error: null }; }, sessionValid: async () => true };
  await offlineDb.ops.update(receipt.opId, { status: 'discarded' });
  await syncOp(adjust, deps);
  expect(sent).toBe(0);
  expect(await offlineDb.ops.get(adjust.opId)).toMatchObject({ status: 'needs_attention', reasonCode: 'DEPENDS_ON_UNSYNCED' });
});

test('device stock is snapshot plus receipts and deltas minus sales of every cashier on this PC', async () => {
  await receive('r7', { quantity: 5, selling_price: 12 });
  await enqueueOp({ userId: 'other', branchId: 'branch', opType: 'stock.adjust', opId: 'a3', entityId: 'item',
    values: { branch_item_id: 'item', delta: -2, reason_type: 'damage' } }, false);
  await offlineDb.sales.bulkAdd([sale('s1', 'user', 3), sale('s2', 'other', 2), sale('s3', 'other', 4, 'discarded')]);
  const ops = await offlineDb.ops.where('branchId').equals('branch').toArray();
  const sales = await offlineDb.sales.where('branchId').equals('branch').toArray();
  // 10 snapshot + 5 received - 2 adjusted - 3 - 2 sold (discarded sale does not reserve)
  expect(stockOnDevice(10, 'item', 'branch', ops, sales)).toBe(8);
});

test('received stock is sellable in the offline catalog, expired receipts are not', async () => {
  await receive('r8', { quantity: 5, selling_price: 12, expiry_date: '2027-01-01' });
  await receive('r9', { quantity: 4, selling_price: 12, expiry_date: '2026-10-01' }, 'other');
  const ops = await offlineDb.ops.where('branchId').equals('branch').toArray();
  expect(stockDelta('item', 'branch', ops)).toBe(9);
  expect(stockDelta('item', 'branch', ops, true, DEVICE_DAY)).toBe(5);
});

test('applied op settles into the catalog once and a refreshed snapshot is not double counted', async () => {
  const op = await receive('r10', { quantity: 5, selling_price: 12 });
  await settleOp(op, applied(op.opId));
  const item = await offlineDb.catalog.get('item');
  expect(item?.serverAvailable).toBe(15);
  expect(item?.batches?.some(b => b.id === op.entityId && b.remaining_quantity === 5)).toBe(true);
  const ops = await offlineDb.ops.where('branchId').equals('branch').toArray();
  // Synced ops are excluded from the overlay, so the refreshed server snapshot (15) stays 15.
  expect(stockDelta('item', 'branch', ops)).toBe(0);
  expect(stockOnDevice(15, 'item', 'branch', ops, [])).toBe(15);
  // Settling again is a no-op.
  await settleOp(op, applied(op.opId));
  expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(15);
});

test('applied stock op marks branch read snapshots stale but keeps serving them', async () => {
  const req = describeRequest('https://db.example/rest/v1/branch_items?select=*&branch_id=eq.branch', 'GET', {});
  await saveReadEntry('user', 'branch', req, 200, JSON.stringify([{ id: 'item', quantity: 10 }]), null);
  const op = await receive('r11', { quantity: 5, selling_price: 12 });
  await settleOp(op, applied(op.opId));
  const cached = await readCachedResponse('user', 'branch', req);
  expect(cached).toBeTruthy();
  expect(JSON.parse(cached!.body!)[0].quantity).toBe(10);
  const entry = await offlineDb.readCache.get(['user', 'branch', req.queryKey]);
  expect(entry?.stale).toBe(true);
  // A fresh online read overwrites the entry and clears the stale flag.
  await saveReadEntry('user', 'branch', req, 200, JSON.stringify([{ id: 'item', quantity: 15 }]), null);
  expect((await offlineDb.readCache.get(['user', 'branch', req.queryKey]))?.stale).toBeUndefined();
});

test('NEGATIVE_STOCK, SUPPLIER_NOT_FOUND and NOT_FOUND map to cashier text and owner force labels', () => {
  expect(opReason('NEGATIVE_STOCK', { current: 3, delta: -5 })).toBe('Not enough stock: batch has 3, change was -5.');
  expect(opReason('SUPPLIER_NOT_FOUND')).toBe('The supplier is no longer available. The owner can receive without supplier.');
  expect(opReason('NOT_FOUND', { what: 'batch' })).toBe('This batch no longer exists. Void this change.');
  expect(ownerForceLabel('NEGATIVE_STOCK', true)).toBe("Write off what's left");
  expect(ownerForceLabel('SUPPLIER_NOT_FOUND', true)).toBe('Receive without supplier');
  expect(ownerForceLabel('VERSION_CONFLICT', true)).toBeUndefined();
  expect(ownerForceLabel('DUPLICATE_NAME', true)).toBeUndefined();
  expect(ownerForceLabel('VERSION_CONFLICT')).toBe('Keep offline change');
});

test('read-only inventory permission disables offline stock controls', async () => {
  expect(await canEnqueueOp('user', 'stock', 'branch')).toBe(true);
  await offlineDb.meta.put({ key: 'permissions:user', value: { customers: 'edit', suppliers: 'edit', inventory: 'read' } });
  expect(await canEnqueueOp('user', 'stock', 'branch')).toBe(false);
  await expect(receive('r12', { quantity: 5, selling_price: 12 })).rejects.toThrow('edit permission');
});

test('pending receive/adjust activities de-duplicate against server rows', async () => {
  const receipt = await receive('r13', { quantity: 5, selling_price: 12 });
  const adjust = await enqueueOp({ userId: 'user', branchId: 'branch', opType: 'stock.adjust', opId: 'a4', entityId: 'item',
    values: { branch_item_id: 'item', delta: -1, reason_type: 'damage' } });
  const ops = await offlineDb.ops.where('userId').equals('user').toArray();
  const rows = pendingOpActivityRows(ops, 'user');
  expect(rows.map(r => r.activity_type).sort()).toEqual(['adjust_stock', 'receive_stock']);
  const serverRows = [{ client_txn_id: receipt.opId, metadata: { op_id: receipt.opId } }] as never[];
  const deduped = pendingOpActivityRows(ops, 'user', serverRows);
  expect(deduped.map(r => r.activity_type)).toEqual(['adjust_stock']);
  expect(deduped[0].entity_id).toBe(adjust.entityId);
});

test('backup and restore round-trip keeps stock ops with unchanged payloads', async () => {
  const receipt = await receive('r14', { quantity: 5, selling_price: 12, batch_number: 'B9' });
  const doc = buildBackupDocument([], 'user', 'device', new Date('2026-10-29T12:00:00Z'), await offlineDb.ops.where('userId').equals('user').toArray());
  expect(doc.ops).toHaveLength(1);
  const parsed = parseBackup(JSON.stringify(doc));
  await offlineDb.ops.clear();
  const result = await restoreBackup(parsed, 'user');
  expect(result.restored + result.present).toBe(1);
  const restored = await offlineDb.ops.get(receipt.opId);
  expect(restored?.payload).toEqual(receipt.payload);
  expect(restored?.opType).toBe('stock.receive');
  expect(restored?.stockItemId).toBe('item');
});

test('Dexie version 5 keeps existing sales, catalog, meta and read cache data', async () => {
  expect(offlineDb.verno).toBe(5);
  await offlineDb.sales.add(sale('keep-me', 'user', 1));
  await offlineDb.readCache.add({ userId: 'user', scopeKey: 'branch', queryKey: 'q', path: '/rest/v1/customers', select: '*',
    filters: [], paged: false, accept: '', status: 200, contentRange: null, data: '[]', savedAt: DEVICE_DAY, lastUsedAt: 1, size: 2, dated: false, schemaVersion: 1 });
  await offlineDb.close();
  await offlineDb.open();
  expect(await offlineDb.sales.get('keep-me')).toBeTruthy();
  expect((await offlineDb.catalog.get('item'))?.serverAvailable).toBe(10);
  expect(await offlineDb.meta.get('profile:user')).toBeTruthy();
  expect(await offlineDb.readCache.get(['user', 'branch', 'q'])).toBeTruthy();
});

test('batch availability reserves local sales in FEFO order before a decrease', async () => {
  const context = await stockContext('user', 'item', 'branch');
  expect(context.item?.id).toBe('item');
  const batches = [
    { id: 'old', branch_id: 'branch', branch_item_id: 'item', medicine_id: 'med', created_by: 'user', created_at: '2026-01-01',
      quantity: 4, remaining_quantity: 4, purchase_price: 1, selling_price: 2, expiry_date: '2026-11-01', batch_number: null, supplier_id: null },
    { id: 'new', branch_id: 'branch', branch_item_id: 'item', medicine_id: 'med', created_by: 'user', created_at: '2026-02-01',
      quantity: 6, remaining_quantity: 6, purchase_price: 1, selling_price: 2, expiry_date: '2027-06-01', batch_number: null, supplier_id: null },
  ];
  const sales = [sale('s9', 'other', 5)];
  expect(batchAvailableOnDevice('old', batches, sales, 'item', 'branch')).toBe(0);
  expect(batchAvailableOnDevice('new', batches, sales, 'item', 'branch')).toBe(5);
  expect(overlayBatches(batches, [], 'item', 'branch').map(b => b.id)).toEqual(['old', 'new']);
});
