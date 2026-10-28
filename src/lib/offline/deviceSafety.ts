import { exportOp, unresolvedOp, type LocalOp } from './opTypes';
import { offlineDb } from './db';
import type { LocalSale } from './types';
import { withPosLock } from './network';

export const isUnresolved = (sale: LocalSale) => ['pending', 'syncing', 'needs_attention', 'discarded'].includes(sale.status);
export function exportFingerprint(records: LocalSale[], ops: LocalOp[] = []) {
  return [...records.filter(isUnresolved).map(r => `${r.clientTxnId}:${r.updatedAt}:${r.status}`), ...ops.filter(unresolvedOp).map(o => `op:${o.opId}:${o.updatedAt}:${o.status}`)].sort().join('|');
}
export async function userSales(userId: string) {
  return (await offlineDb.sales.where('userId').equals(userId).sortBy('createdAt')).reverse();
}
export async function otherUserUnresolvedCount(userId: string) {
  return offlineDb.sales.filter(r => r.userId !== userId && isUnresolved(r)).count();
}
// Explicit allowlist: never export auth storage, cached profiles or credentials.
export const EXPORT_FIELDS = ['clientTxnId', 'userId', 'branchId', 'payload', 'mode', 'status', 'attempts', 'lastError',
  'reasonCode', 'reasonDetail', 'serverSaleId', 'issueId', 'summary', 'createdAt', 'updatedAt', 'syncedAt',
  'discardNote', 'discardedBy', 'discardedAt'] as const;
export type ExportedSale = Pick<LocalSale, typeof EXPORT_FIELDS[number]>;
export function exportRecord(r: LocalSale): ExportedSale {
  const out: Record<string, unknown> = {};
  for (const key of EXPORT_FIELDS) out[key] = r[key];
  return out as ExportedSale;
}
export function exportDocument(records: LocalSale[], userId: string, ops: LocalOp[] = []) {
  return { format: 'pharmaxpert-pos-export', version: 2, exportedAt: new Date().toISOString(),
    // Include confirmed predecessors so exports remain a complete recovery chain.
    userId, ops: ops.filter(o => o.userId === userId).map(exportOp),
    sales: records.filter(r => r.userId === userId && isUnresolved(r)).map(exportRecord) };
}
export async function exportPendingSales(userId: string): Promise<string> {
  const { records, ops } = await withPosLock(() => offlineDb.transaction('r', offlineDb.sales, offlineDb.ops, async () => ({ records: await userSales(userId), ops: await offlineDb.ops.where('userId').equals(userId).toArray() })));
  const blob = new Blob([JSON.stringify(exportDocument(records, userId, ops), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url;
  link.download = `pending-sales-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return exportFingerprint(records, ops);
}
export async function retryUserSales(userId: string, txnId?: string) {
  await withPosLock(() => offlineDb.sales.where('userId').equals(userId)
    .and(r => (!txnId || r.clientTxnId === txnId) && (r.status === 'pending' || (!!txnId && r.status === 'needs_attention' && !r.issueId)))
    .modify({ status: 'pending', attempts: 0, nextAttemptAt: Date.now(), updatedAt: new Date().toISOString() }));
}
export async function discardUserSale(userId: string, txnId: string, note: string) {
  if (!note.trim()) throw new Error('Enter a note before discarding this sale.');
  await withPosLock(() => offlineDb.transaction('rw', offlineDb.sales, async () => {
    const record = await offlineDb.sales.get(txnId);
    if (!record || record.userId !== userId || record.status !== 'needs_attention' || record.issueId) throw new Error('Only a device-only refused sale can be discarded.');
    const now = new Date().toISOString();
    await offlineDb.sales.update(txnId, { status: 'discarded', discardNote: note.trim(), discardedBy: userId, discardedAt: now, updatedAt: now });
  }));
}
/** Explicit retirement only. Caller holds the POS lock through cleanup and sign-out. */
export async function clearUserDeviceData(userId: string, exported?: string) {
  await offlineDb.transaction('rw', [offlineDb.sales, offlineDb.catalog, offlineDb.meta, offlineDb.readCache, offlineDb.ops], async () => {
    const records = await userSales(userId);
    const ops = await offlineDb.ops.where('userId').equals(userId).toArray();
    if ((records.some(isUnresolved) || ops.some(unresolvedOp)) && exported !== exportFingerprint(records, ops)) {
      throw new Error('Export the current waiting sales and records before removing your data.');
    }
    await offlineDb.catalog.where('ownerKey').equals(userId).delete();
    await offlineDb.meta.filter(row => row.key.split(':').includes(userId)).delete();
    await offlineDb.sales.where('userId').equals(userId).delete();
    await offlineDb.readCache.where('userId').equals(userId).delete();
    await offlineDb.ops.where('userId').equals(userId).delete();
  });
}