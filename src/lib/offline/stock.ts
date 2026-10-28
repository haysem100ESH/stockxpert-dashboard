import { offlineDb } from './db';
import { RESERVING_STATUSES, availableStock } from './rules';
import { addisDayString } from '@/lib/timezone';
import type { InventoryBatch } from '@/lib/batchInventory';
import type { LocalOp, OpType } from './opTypes';
import type { LocalSale } from './types';

export const RECEIVE_FIELDS = ['branch_item_id', 'quantity', 'selling_price', 'purchase_price', 'expiry_date', 'batch_number', 'supplier_id', 'min_stock_level', 'expiry_alert_days'] as const;
export const ADJUST_FIELDS = ['batch_id', 'branch_item_id', 'delta', 'reason_type', 'note'] as const;
export function stockPayload(type: OpType, values: Record<string, unknown>, deviceDate = addisDayString()): Record<string, string | number | null> {
  const fields = type === 'stock.receive' ? RECEIVE_FIELDS : ADJUST_FIELDS;
  const p: Record<string, string | number | null> = {};
  for (const key of fields) {
    if (values[key] === undefined || values[key] === '' || values[key] === null) continue;
    const value = values[key];
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Invalid ${key}.`);
    p[key] = typeof value === 'string' ? value.trim() : value;
  }
  const number = (field: string, min: number, max: number, required = false, strictMin = false) => {
    const v = p[field];
    if (v === undefined && !required) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || (strictMin ? v <= min : v < min) || v > max) throw new Error(`Invalid ${field}.`);
  };
  const id = (field: string) => typeof p[field] === 'string' && !!p[field];
  if (type === 'stock.receive') {
    if (!id('branch_item_id')) throw new Error('Select an existing item.');
    number('quantity', 0, 1_000_000, true, true); number('selling_price', 0, Number.MAX_VALUE, true, true);
    number('purchase_price', 0, Number.MAX_VALUE); number('min_stock_level', 0, Number.MAX_VALUE); number('expiry_alert_days', 0, 3650);
    if (p.expiry_alert_days !== undefined && !Number.isInteger(p.expiry_alert_days)) throw new Error('Alert days must be a whole number.');
    if (p.expiry_date !== undefined && (typeof p.expiry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.expiry_date)
      || !Number.isFinite(Date.parse(`${p.expiry_date}T00:00:00Z`)) || new Date(`${p.expiry_date}T00:00:00Z`).toISOString().slice(0, 10) !== p.expiry_date || p.expiry_date < deviceDate)) throw new Error('Expiry date cannot be before the device date in Addis Ababa.');
    if (p.batch_number !== undefined && (typeof p.batch_number !== 'string' || p.batch_number.length > 100)) throw new Error('Batch number must be 100 characters or fewer.');
    if (p.supplier_id !== undefined && !id('supplier_id')) throw new Error('Invalid supplier.');
  } else {
    if (Number(id('batch_id')) + Number(id('branch_item_id')) !== 1) throw new Error('Choose one batch, or an item without batches.');
    number('delta', -1_000_000, 1_000_000, true);
    if (p.delta === 0 || !['damage', 'expired', 'count_correction', 'other'].includes(String(p.reason_type))) throw new Error('Enter a non-zero change and a valid reason.');
    if (['damage', 'expired'].includes(String(p.reason_type)) && Number(p.delta) >= 0) throw new Error('Damage and expired write-offs must decrease stock.');
    if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 500)) throw new Error('Note must be 500 characters or fewer.');
    if (['count_correction', 'other'].includes(String(p.reason_type)) && !p.note) throw new Error('A note is required for count correction or other.');
  }
  return p;
}
export const activeStockOp = (op: LocalOp) => op.entityType === 'stock' && !op.ownerVoided && RESERVING_STATUSES.some(s => s === op.status);
export const stockItemId = (op: LocalOp) => op.stockItemId ?? (typeof op.payload.branch_item_id === 'string' ? op.payload.branch_item_id : undefined);
export function stockDelta(itemId: string, branchId: string, ops: LocalOp[], sellable = false, today = addisDayString()) {
  return ops.filter(o => activeStockOp(o) && o.branchId === branchId && stockItemId(o) === itemId)
    .reduce((sum, o) => sum + (o.opType === 'stock.receive'
      ? (!sellable || !o.payload.expiry_date || String(o.payload.expiry_date) >= today ? Number(o.payload.quantity) : 0)
      : Number(o.payload.delta)), 0);
}
export function stockOnDevice(snapshot: number, itemId: string, branchId: string, ops: LocalOp[], sales: LocalSale[], sellable = false) {
  return availableStock(snapshot + stockDelta(itemId, branchId, ops, sellable), itemId, sales.filter(s => s.branchId === branchId));
}
/** Read existing shared cache only; no additional offline storage system or server query. */
export async function cachedStockRows(path: string, userId: string): Promise<Record<string, any>[]> {
  const entries = await offlineDb.readCache.where('[userId+path]').equals([userId, `/rest/v1/${path}`]).toArray();
  const rows = new Map<string, Record<string, any>>();
  for (const e of entries.sort((a, b) => a.savedAt.localeCompare(b.savedAt))) {
    try { const parsed = JSON.parse(e.data); for (const row of Array.isArray(parsed) ? parsed : [parsed]) if (row?.id) rows.set(row.id, { ...rows.get(row.id), ...row }); } catch { /* malformed read is not usable */ }
  }
  return [...rows.values()];
}
export function overlayBatches(rows: InventoryBatch[], ops: LocalOp[], itemId: string, branchId: string): Array<InventoryBatch & { offlineBadge?: string; pendingDelta?: number }> {
  const map = new Map(rows.map(r => [r.id, { ...r, pendingDelta: 0 }]));
  for (const o of [...ops].sort((a, b) => a.deviceCreatedAt.localeCompare(b.deviceCreatedAt))) {
    if (!activeStockOp(o) || stockItemId(o) !== itemId || o.branchId !== branchId) continue;
    if (o.opType === 'stock.receive') map.set(o.entityId, { id: o.entityId, branch_id: branchId, branch_item_id: itemId, medicine_id: '', created_by: o.userId,
      created_at: o.deviceCreatedAt, quantity: Number(o.payload.quantity), remaining_quantity: Number(o.payload.quantity), selling_price: Number(o.payload.selling_price),
      purchase_price: Number(o.payload.purchase_price ?? 0), expiry_date: o.payload.expiry_date as string ?? null, batch_number: o.payload.batch_number as string ?? null,
      supplier_id: o.payload.supplier_id as string ?? null, pendingDelta: Number(o.payload.quantity), offlineBadge: o.status === 'needs_attention' ? 'Needs attention' : o.status === 'syncing' ? 'Syncing' : 'Pending sync' } as InventoryBatch & { pendingDelta: number });
    else { const b = map.get(o.entityId); if (b) map.set(o.entityId, { ...b, remaining_quantity: b.remaining_quantity + Number(o.payload.delta), pendingDelta: b.pendingDelta + Number(o.payload.delta) }); }
  }
  return [...map.values()];
}
export async function stockContext(userId: string, itemId: string, branchId: string) {
  const catalog = await offlineDb.catalog.get(itemId);
  const item = catalog?.ownerKey === userId && catalog.branchId === branchId ? { ...catalog, quantity: catalog.serverAvailable, updated_at: undefined } :
    (await cachedStockRows('branch_items', userId)).find(r => r.id === itemId && r.branch_id === branchId);
  const cachedBatches = catalog?.ownerKey === userId && catalog.batches !== undefined ? catalog.batches :
    (await cachedStockRows('inventory_batches', userId)).filter(r => r.branch_item_id === itemId && r.branch_id === branchId && r.remaining_quantity !== undefined) as InventoryBatch[];
  const ops = await offlineDb.ops.where('branchId').equals(branchId).toArray();
  const sales = await offlineDb.sales.where('branchId').equals(branchId).toArray();
  // Missing batch snapshots must not be mistaken for a verified unbatched item.
  const batchKnown = catalog?.batches !== undefined || (await offlineDb.readCache.where('[userId+path]').equals([userId, '/rest/v1/inventory_batches']).toArray())
    .some(e => e.select === '*' && e.filters.includes(`branch_item_id=eq.${itemId}`));
  return { item, batches: overlayBatches(cachedBatches, ops, itemId, branchId), ops, sales, batchKnown };
}
/** Allocate local sale reservations in FEFO order before validating a batch decrease. */
export function batchAvailableOnDevice(batchId: string, batches: InventoryBatch[], sales: LocalSale[], itemId: string, branchId: string) {
  let reserved = sales.filter(s => s.branchId === branchId && RESERVING_STATUSES.some(t => t === s.status))
    .reduce((sum, s) => sum + s.payload.items.filter(i => i.branch_item_id === itemId).reduce((n, i) => n + i.base_quantity, 0), 0);
  const today = addisDayString();
  for (const batch of [...batches].sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') || a.created_at.localeCompare(b.created_at))) {
    const deduction = !batch.expiry_date || batch.expiry_date >= today ? Math.min(Math.max(0, batch.remaining_quantity), reserved) : 0;
    reserved -= deduction;
    if (batch.id === batchId) return Math.max(0, batch.remaining_quantity - deduction);
  }
  return 0;
}