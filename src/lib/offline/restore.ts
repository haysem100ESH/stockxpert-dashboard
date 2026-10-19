import { offlineDb } from './db';
import { withPosLock } from './network';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupDocument } from './backup';
import type { ExportedSale } from './deviceSafety';
import type { LocalSale } from './types';

export const OTHER_CASHIER = 'This backup belongs to another cashier. That cashier must sign in on this PC to restore it.';
export interface RestorePreview { count: number; from?: string; to?: string; total: number; statuses: Record<string, number> }
export interface RestoreResult { restored: number; present: number; skippedSynced: number; invalid: number }

const STATUSES = ['pending', 'syncing', 'synced', 'needs_attention', 'voided', 'discarded'];
export function validRecord(r: unknown, userId: string): r is ExportedSale {
  const s = r as Partial<ExportedSale> | null;
  return !!s && typeof s.clientTxnId === 'string' && !!s.clientTxnId && s.userId === userId && typeof s.branchId === 'string'
    && !!s.payload && typeof s.payload === 'object' && s.payload.client_txn_id === s.clientTxnId && Array.isArray(s.payload.items)
    && typeof s.status === 'string' && STATUSES.includes(s.status) && !!s.summary && typeof s.createdAt === 'string';
}
/** Throws a cashier-readable error when the file cannot be restored by this user. */
export function parseBackup(text: string, userId: string): BackupDocument {
  let doc: Partial<BackupDocument>;
  try { doc = JSON.parse(text); } catch { throw new Error('This file is not a valid backup (unreadable JSON).'); }
  if (!doc || doc.format !== BACKUP_FORMAT) throw new Error('This file is not a PharmaXpert backup.');
  if (doc.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${String(doc.version)}.`);
  if (typeof doc.userId !== 'string' || typeof doc.deviceId !== 'string' || typeof doc.generatedAt !== 'string' || !Array.isArray(doc.sales))
    throw new Error('This backup is missing required fields.');
  if (doc.userId !== userId) throw new Error(OTHER_CASHIER);
  return doc as BackupDocument;
}
export function previewBackup(doc: BackupDocument): RestorePreview {
  const valid = doc.sales.filter(r => validRecord(r, doc.userId));
  const dates = valid.map(r => r.payload.device_created_at || r.createdAt).sort();
  const statuses: Record<string, number> = {};
  for (const r of valid) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  return { count: doc.sales.length, from: dates[0], to: dates[dates.length - 1], statuses,
    total: Number(valid.reduce((n, r) => n + Number(r.payload.total_amount || 0), 0).toFixed(2)) };
}
export async function restoreBackup(doc: BackupDocument, userId: string): Promise<RestoreResult> {
  if (doc.userId !== userId) throw new Error(OTHER_CASHIER);
  const result: RestoreResult = { restored: 0, present: 0, skippedSynced: 0, invalid: 0 };
  await withPosLock(() => offlineDb.transaction('rw', offlineDb.sales, async () => {
    const now = new Date().toISOString();
    for (const r of doc.sales) {
      if (!validRecord(r, userId)) { result.invalid++; continue; }
      if (r.status === 'synced' || r.status === 'voided') { result.skippedSynced++; continue; }
      if (await offlineDb.sales.get(r.clientTxnId)) { result.present++; continue; }
      const record: LocalSale = { ...r, mode: r.mode === 'online' ? 'online' : 'offline', attempts: 0,
        status: r.status === 'discarded' ? 'discarded' : 'pending', nextAttemptAt: Date.now(), updatedAt: now };
      await offlineDb.sales.add(record);
      result.restored++;
    }
  }));
  return result;
}
