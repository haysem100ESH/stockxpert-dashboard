import { opBadge, type LocalOp } from './opTypes';
import type { ActivityRow } from '@/hooks/useActivityFeed';
import type { LocalSale, PosPayload } from './types';
import { readMeta, writeMeta } from './db';
import { reasonMessage } from './rules';

export interface ActivitySnapshot<T> { data: T; savedAt: string }
export const activityCacheKey = (userId: string, scope: string) => `activity:${userId}:${scope}`;
export async function saveActivityCache<T>(userId: string, scope: string, data: T, savedAt = new Date().toISOString()) {
  const snapshot = { data, savedAt };
  await writeMeta(activityCacheKey(userId, scope), snapshot);
  return snapshot;
}
export function readActivityCache<T>(userId: string, scope: string) {
  return readMeta<ActivitySnapshot<T>>(activityCacheKey(userId, scope));
}
export function offlineActivityMessage(reachable: boolean, savedAt?: string) {
  if (reachable) return undefined;
  return savedAt ? `Offline — showing activity saved at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : 'This date was not loaded before going offline.';
}
/** Only call for a new checkout, never for restored or queued payloads. */
export function newSaleActivityFields(now = new Date()): Pick<PosPayload, 'server_activity' | 'device_created_at'> {
  return { server_activity: true, device_created_at: now.toISOString() };
}
export function pendingActivityBadge(record: LocalSale) {
  switch (record.status) {
    case 'pending': return 'Pending sync';
    case 'syncing': return 'Syncing';
    case 'needs_attention': return `Needs attention: ${reasonMessage(record.reasonCode, record.reasonDetail)}`;
    case 'discarded': return 'Discarded — not recorded';
    default: return undefined;
  }
}
export interface ActivityRange { from?: Date; to?: Date }
export function pendingActivityRows(records: LocalSale[], userId: string, serverRows: ActivityRow[] = [], range: ActivityRange = {}): ActivityRow[] {
  const recorded = new Set(serverRows.map(row => row.client_txn_id ?? row.metadata?.client_txn_id).filter(Boolean));
  return records.flatMap(record => {
    const badge = pendingActivityBadge(record);
    const createdAt = record.payload.device_created_at || record.createdAt;
    const timestamp = new Date(createdAt).getTime();
    if (record.userId !== userId || !badge || recorded.has(record.clientTxnId) || !Number.isFinite(timestamp)
      || (range.from && timestamp < +range.from) || (range.to && timestamp >= +range.to)) return [];
    return [{ id: `local:${record.clientTxnId}`, user_id: userId, owner_id: userId, branch_id: record.branchId,
      activity_type: 'sell_item', entity_type: 'sale', entity_id: record.serverSaleId ?? null,
      previous_value: null, new_value: null, created_at: createdAt, client_txn_id: record.clientTxnId,
      pendingBadge: badge, metadata: { ...record.summary, payment_method: record.payload.payment_method,
        discount: record.payload.discount_amount, sale_date: record.payload.sale_date,
        client_txn_id: record.clientTxnId, origin: record.mode, device_created_at: createdAt } }];
  }).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}
export function pendingActivityCounts(rows: ActivityRow[], now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(week.getDate() + (week.getDay() === 0 ? -6 : 1 - week.getDay()));
  const month = new Date(today); month.setDate(1);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const count = (from: Date) => rows.filter(row => +new Date(row.created_at) >= +from && +new Date(row.created_at) < +tomorrow).length;
  return { today: count(today), week: count(week), month: count(month) };
}
export function pendingOpActivityRows(ops: LocalOp[], userId: string, serverRows: ActivityRow[] = [], range: ActivityRange = {}): ActivityRow[] {
  const recorded = new Set(serverRows.flatMap(row => [row.client_txn_id, row.metadata?.op_id, row.metadata?.client_txn_id]).filter(Boolean));
  return ops.flatMap(op => {
    const badge = opBadge(op); const stamp = Date.parse(op.deviceCreatedAt);
    if (op.userId !== userId || !badge || op.ownerVoided || recorded.has(op.opId) || !Number.isFinite(stamp)
      || (range.from && stamp < +range.from) || (range.to && stamp >= +range.to)) return [];
    return [{ id: `local-op:${op.opId}`, user_id: userId, owner_id: userId, branch_id: op.branchId,
      activity_type: `${op.opType.endsWith('.create') ? 'create' : 'edit'}_${op.entityType}`, entity_type: op.entityType,
      entity_id: op.entityId, previous_value: null, new_value: op.payload, metadata: { ...op.payload, op_id: op.opId },
      created_at: op.deviceCreatedAt, client_txn_id: op.opId, pendingBadge: badge }];
  });
}
