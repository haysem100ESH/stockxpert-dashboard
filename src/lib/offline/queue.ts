import { offlineDb } from './db';
import { availableStock, hasCredit, reasonMessage } from './rules';
import type { LocalSale, RpcResult } from './types';

export async function enqueueSale(record: LocalSale, validateStock: boolean) {
  await offlineDb.transaction('rw', offlineDb.sales, offlineDb.catalog, offlineDb.meta, async () => {
    const existing = await offlineDb.sales.get(record.clientTxnId);
    if (existing) return;
    if (validateStock) {
      if (hasCredit(record.payload) || record.payload.customer_id) throw new Error(reasonMessage('CREDIT_NOT_ALLOWED_OFFLINE'));
      const allowed = (await offlineDb.meta.get(`branches:${record.userId}`))?.value as string[] | undefined;
      if (!allowed?.includes(record.branchId)) throw new Error(reasonMessage('BRANCH_NOT_AUTHORIZED'));
      const reservations = await offlineDb.sales.where('branchId').equals(record.branchId).toArray();
      const requested = new Map<string, number>();
      for (const item of record.payload.items) {
        if (!Number.isFinite(item.base_quantity) || item.base_quantity <= 0) throw new Error(reasonMessage('INVALID_QUANTITY'));
        requested.set(item.branch_item_id, (requested.get(item.branch_item_id) ?? 0) + item.base_quantity);
      }
      for (const [id, quantity] of requested) {
        const item = await offlineDb.catalog.get(id);
        if (!item || item.ownerKey !== record.userId || item.branchId !== record.branchId) throw new Error(reasonMessage('ITEM_NOT_IN_BRANCH'));
        if (quantity > availableStock(item.serverAvailable, id, reservations) + 0.00001) throw new Error(reasonMessage('INSUFFICIENT_STOCK', { item: item.name, available: availableStock(item.serverAvailable, id, reservations) }));
      }
    }
    await offlineDb.sales.add(record);
  });
}
export async function settleSale(record: LocalSale, result: RpcResult) {
  const now = new Date().toISOString();
  await offlineDb.transaction('rw', offlineDb.sales, offlineDb.catalog, offlineDb.meta, async () => {
    if (result.status === 'synced') {
      // Move the reservation into the snapshot atomically until server refresh.
      for (const line of record.payload.items) {
        const item = await offlineDb.catalog.get(line.branch_item_id);
        if (item) await offlineDb.catalog.update(item.id, { serverAvailable: Math.max(0, item.serverAvailable - line.base_quantity) });
      }
      await offlineDb.sales.put({ ...record, status: 'synced', serverSaleId: result.sale_id, syncedAt: now, updatedAt: now, lastError: undefined });
      await offlineDb.meta.put({ key: `lastSuccessfulSync:${record.userId}`, value: now });
    } else {
      await offlineDb.sales.put({ ...record, status: result.status === 'voided' ? 'voided' : 'needs_attention',
        reasonCode: result.reason_code, reasonDetail: result.reason_detail, issueId: result.issue_id,
        lastError: reasonMessage(result.reason_code, result.reason_detail), updatedAt: now });
    }
  });
}