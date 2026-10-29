import { offlineDb } from './db';
import { supabase } from '@/lib/db';
import { validSession } from './network';
import { isPermanentPosError, errorCode, errorMessage } from './errors';
import { retryDelay } from './rules';
import { opReason, type LocalOp, type OpResult } from './opTypes';
import { stockItemId } from './stock';

export function opRequest(op: LocalOp) {
  return { op_id: op.opId, op_type: op.opType, branch_id: op.branchId, entity_id: op.entityId, payload: op.payload,
    ...(op.baseUpdatedAt ? { base_updated_at: op.baseUpdatedAt } : {}), ...(op.prevOpId ? { prev_op_id: op.prevOpId } : {}), device_created_at: op.deviceCreatedAt };
}
export async function settleOp(op: LocalOp, result: OpResult) {
  const now = new Date().toISOString();
  await offlineDb.transaction('rw', offlineDb.ops, offlineDb.meta, offlineDb.catalog, offlineDb.readCache, async () => {
    const current = await offlineDb.ops.get(op.opId);
    if (!current || current.status === 'synced' || current.ownerVoided) return;
    if (result.status === 'applied' && op.entityType === 'stock') {
      const itemId = result.branch_item_id ?? result.result?.branch_item_id ?? stockItemId(op);
      const delta = op.opType === 'stock.receive' ? Number(op.payload.quantity) : Number(op.payload.delta);
      const item = itemId ? await offlineDb.catalog.get(itemId) : undefined;
      if (item?.branchId === op.branchId) {
        const batches = item.batches ? [...item.batches] : undefined;
        if (batches && op.opType === 'stock.receive' && !batches.some(b => b.id === op.entityId)) batches.push({ id: op.entityId, branch_id: op.branchId, branch_item_id: item.id, medicine_id: item.medicine_id,
          quantity: delta, remaining_quantity: delta, purchase_price: Number(op.payload.purchase_price ?? 0), selling_price: Number(op.payload.selling_price),
          expiry_date: op.payload.expiry_date as string ?? null, batch_number: op.payload.batch_number as string ?? null, supplier_id: op.payload.supplier_id as string ?? null, created_at: op.deviceCreatedAt, created_by: op.userId });
        else if (batches) { const batch = batches.find(b => b.id === op.entityId); if (batch) batch.remaining_quantity = Math.max(0, batch.remaining_quantity + delta); }
        await offlineDb.catalog.update(item.id, { serverAvailable: Math.max(0, item.serverAvailable + delta), batches });
      }
      // Mark affected read snapshots stale but keep serving them: a refetch is only guaranteed
      // for currently visible queries, and deleting them could make Inventory unavailable offline.
      // Synced ops are excluded from the overlay, so kept snapshots are never double counted;
      // the next successful online read overwrites the entry and clears the flag.
      await offlineDb.readCache.filter(e => ['inventory_batches', 'branch_items'].some(t => e.path === `/rest/v1/${t}`)
        && (e.scopeKey === op.branchId || e.scopeKey === 'owner-all' || e.scopeKey === 'global')).modify({ stale: true });
    }
    await offlineDb.ops.update(op.opId, result.status === 'applied'
      ? { status: 'synced', serverUpdatedAt: result.updated_at, lastError: undefined, reasonCode: undefined, serverIssue: false, updatedAt: now }
      : result.status === 'voided'
        ? { status: 'discarded', ownerVoided: true, serverIssue: true, discardNote: result.resolution_note ?? '', discardedAt: now, reasonCode: 'VOIDED_BY_OWNER', updatedAt: now }
        : { status: 'needs_attention', reasonCode: result.reason_code, details: result.details ?? (typeof result.reason_detail === 'object' ? result.reason_detail as Record<string, unknown> : undefined),
          lastError: typeof result.reason_detail === 'string' ? result.reason_detail : opReason(result.reason_code, result.details ?? result.reason_detail as Record<string, unknown>), serverIssue: result.status === 'needs_attention', updatedAt: now });
    if (result.status === 'applied') await offlineDb.meta.put({ key: `lastSuccessfulSync:${op.userId}`, value: now });
  });
}
/** Shared sync-loop work item; caller holds the same POS lock as sale processing. */
export async function syncOp(op: LocalOp, deps = {
  call: async (p_op: ReturnType<typeof opRequest>): Promise<{ data: unknown; error: unknown }> => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
    try { return await supabase.rpc('apply_offline_op', { p_op }).abortSignal(controller.signal); }
    finally { clearTimeout(timer); }
  }, sessionValid: () => validSession(op.userId),
}): Promise<OpResult | undefined> {
  for (const id of [...new Set([...(op.dependsOn ?? []), ...(op.prevOpId ? [op.prevOpId] : [])])]) {
    const previous = await offlineDb.ops.get(id);
    if (!previous || previous.userId !== op.userId || previous.status !== 'synced') {
      if (!previous || ['needs_attention', 'discarded'].includes(previous.status)) await offlineDb.ops.update(op.opId,
        { status: 'needs_attention', reasonCode: 'DEPENDS_ON_UNSYNCED', serverIssue: false, lastError: opReason('DEPENDS_ON_UNSYNCED'), updatedAt: new Date().toISOString() });
      return;
    }
  }
  await offlineDb.ops.update(op.opId, { status: 'syncing', updatedAt: new Date().toISOString() });
  let result: OpResult;
  try {
    const { data, error } = await deps.call(opRequest(op)); if (error) throw error;
    if (!data || typeof data !== 'object' || !('status' in data) || !['applied', 'needs_attention', 'rejected', 'voided'].includes(String(data.status))) throw new Error('Unknown server outcome');
    result = data as OpResult;
  } catch (error) {
    const attempts = op.attempts + 1; const permanent = await isPermanentPosError(error, deps.sessionValid);
    await offlineDb.ops.update(op.opId, { status: permanent ? 'needs_attention' : 'pending', attempts,
      nextAttemptAt: permanent ? undefined : Date.now() + retryDelay(attempts), serverIssue: false,
      reasonCode: permanent ? errorCode(error) : undefined, lastError: errorMessage(error), updatedAt: new Date().toISOString() });
    return;
  }
  await settleOp(op, result); return result;
}
export async function recoverUserOps(userId: string) {
  await offlineDb.ops.where('userId').equals(userId).and(o => o.status === 'syncing').modify({ status: 'pending', nextAttemptAt: Date.now() });
}
export async function dependencyReady(op: LocalOp) {
  for (const id of [...new Set([...(op.dependsOn ?? []), ...(op.prevOpId ? [op.prevOpId] : [])])]) {
    const prev = await offlineDb.ops.get(id);
    if (prev?.userId !== op.userId || prev.branchId !== op.branchId || prev.status !== 'synced') return false;
  }
  return true;
}