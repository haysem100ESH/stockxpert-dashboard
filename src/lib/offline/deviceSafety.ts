import { offlineDb } from './db';
import type { LocalSale } from './types';
import { withPosLock } from './network';

export const isUnresolved = (sale: LocalSale) => ['pending', 'syncing', 'needs_attention', 'discarded'].includes(sale.status);
export function exportFingerprint(records: LocalSale[]) {
  return records.filter(isUnresolved).map(r => `${r.clientTxnId}:${r.updatedAt}:${r.status}`).sort().join('|');
}
export async function userSales(userId: string) {
  return (await offlineDb.sales.where('userId').equals(userId).sortBy('createdAt')).reverse();
}
// Explicit allowlist: never export auth storage, cached profiles or credentials.
export function exportDocument(records: LocalSale[], userId: string) {
  return { format: 'pharmaxpert-pos-export', version: 1, exportedAt: new Date().toISOString(),
    sales: records.filter(r => r.userId === userId && isUnresolved(r)).map(r => ({
      clientTxnId: r.clientTxnId, userId: r.userId, branchId: r.branchId, payload: r.payload,
      mode: r.mode, status: r.status, attempts: r.attempts, lastError: r.lastError,
      reasonCode: r.reasonCode, reasonDetail: r.reasonDetail, serverSaleId: r.serverSaleId,
      issueId: r.issueId, summary: r.summary, createdAt: r.createdAt, updatedAt: r.updatedAt,
      discardNote: r.discardNote, discardedBy: r.discardedBy, discardedAt: r.discardedAt,
    })) };
}
export async function exportPendingSales(userId: string): Promise<string> {
  const records = await userSales(userId);
  const blob = new Blob([JSON.stringify(exportDocument(records, userId), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url;
  link.download = `pending-sales-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return exportFingerprint(records);
}
export async function retryUserSales(userId: string, txnId?: string) {
  await withPosLock(() => offlineDb.sales.where('userId').equals(userId)
    .and(r => (!txnId || r.clientTxnId === txnId) && (r.status === 'pending' || (!!txnId && r.status === 'needs_attention' && !r.issueId)))
    .modify({ status: 'pending', attempts: 0, nextAttemptAt: Date.now(), updatedAt: new Date().toISOString() }));
}
export async function discardUserSale(userId: string, txnId: string, note: string) {
  if (!note.trim()) throw new Error('Enter a note before discarding this sale.');
  await withPosLock(async () => {
    const record = await offlineDb.sales.get(txnId);
    if (!record || record.userId !== userId || record.status !== 'needs_attention' || record.issueId) throw new Error('Only a device-only refused sale can be discarded.');
    const now = new Date().toISOString();
    await offlineDb.sales.update(txnId, { status: 'discarded', discardNote: note.trim(), discardedBy: userId, discardedAt: now, updatedAt: now });
  });
}
export async function clearUserDeviceData(userId: string, exported?: string) {
  await offlineDb.transaction('rw', offlineDb.sales, offlineDb.catalog, offlineDb.meta, async () => {
    const records = await userSales(userId);
    if (records.some(isUnresolved) && exported !== exportFingerprint(records)) {
      throw new Error('Export the current pending sales before signing out.');
    }
    await offlineDb.catalog.where('ownerKey').equals(userId).delete();
    await offlineDb.meta.filter(row => row.key.split(':').includes(userId)).delete();
    await offlineDb.sales.where('userId').equals(userId).delete();
  });
}