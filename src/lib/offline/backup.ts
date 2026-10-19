import { offlineDb, readMeta, writeMeta } from './db';
import { exportRecord, isUnresolved, type ExportedSale } from './deviceSafety';
import { SYNCED_RETENTION_MS } from './rules';
import { getOfflineState, setOfflineState, type BackupStatus } from './store';
import { addisDayString } from '@/lib/timezone';
import type { LocalSale } from './types';

export const BACKUP_FORMAT = 'pharmaxpert-backup';
export const BACKUP_VERSION = 1;
export const DATED_COPIES = 7;

export interface BackupDocument { format: typeof BACKUP_FORMAT; version: 1; userId: string; deviceId: string; generatedAt: string; sales: ExportedSale[] }
// Minimal File System Access surface so tests can supply a fake directory.
export interface WritableLike { write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
export interface DirHandleLike {
  name?: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableLike> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}

export const backupSupported = () => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
export const backupDirKey = (userId: string) => `backupDir:${userId}`;
// Live handles are kept in memory too; Dexie keeps the structured clone across restarts.
const liveDirs = new Map<string, DirHandleLike>();
export async function rememberBackupDir(userId: string, dir: DirHandleLike) { liveDirs.set(userId, dir); await writeMeta(backupDirKey(userId), dir); }
export async function readBackupDir(userId: string) { return liveDirs.get(userId) ?? await readMeta<DirHandleLike>(backupDirKey(userId)); }

export function buildBackupDocument(records: LocalSale[], userId: string, deviceId: string, now = new Date()): BackupDocument {
  const cutoff = new Date(now.getTime() - SYNCED_RETENTION_MS).toISOString();
  const sales = records.filter(r => r.userId === userId && (isUnresolved(r) || (r.status === 'synced' && !!r.syncedAt && r.syncedAt >= cutoff)))
    .map(exportRecord);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, userId, deviceId, generatedAt: now.toISOString(), sales };
}
export const backupPrefix = (userId: string, deviceId: string) => `pharmaxpert-backup-${userId.slice(0, 8)}-${deviceId}-`;
export const latestName = (userId: string, deviceId: string) => `${backupPrefix(userId, deviceId)}latest.json`;
export const datedName = (userId: string, deviceId: string, now = new Date()) => `${backupPrefix(userId, deviceId)}${addisDayString(now)}.json`;

async function writeFile(dir: DirHandleLike, name: string, text: string) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try { await writable.write(text); await writable.close(); } // close() atomically replaces the file.
  catch (e) { await writable.abort?.().catch(() => {}); throw e; }
}
export async function writeBackupFiles(dir: DirHandleLike, doc: BackupDocument, now = new Date()) {
  const text = JSON.stringify(doc, null, 2);
  await writeFile(dir, latestName(doc.userId, doc.deviceId), text);
  await writeFile(dir, datedName(doc.userId, doc.deviceId, now), text);
  const prefix = backupPrefix(doc.userId, doc.deviceId);
  const dated: string[] = [];
  for await (const name of dir.keys()) if (name.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.json$/.test(name.slice(prefix.length))) dated.push(name);
  dated.sort().reverse();
  for (const old of dated.slice(DATED_COPIES)) await dir.removeEntry(old);
}

export async function getDeviceId(): Promise<string> {
  const existing = await readMeta<string>('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID().slice(0, 8);
  await writeMeta('deviceId', id);
  return id;
}
const reasonOf = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError' ? 'folder not found'
  : e instanceof Error ? e.message : 'unknown error';
const setBackup = (backup: BackupStatus) => setOfflineState({ backup });

/** Writes one backup. Never throws: failures only update the indicator. */
export async function runBackup(userId: string): Promise<BackupStatus> {
  try {
    const dir = await readBackupDir(userId);
    if (!dir) { setBackup({ state: 'not_set_up' }); return getOfflineState().backup; }
    const permission = dir.queryPermission ? await dir.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (permission === 'prompt') { setBackup({ state: 'paused' }); return getOfflineState().backup; }
    if (permission !== 'granted') { setBackup({ state: 'failing', reason: 'permission denied' }); return getOfflineState().backup; }
    const records = await offlineDb.sales.where('userId').equals(userId).toArray();
    const now = new Date();
    await writeBackupFiles(dir, buildBackupDocument(records, userId, await getDeviceId(), now), now);
    setBackup({ state: 'ok', at: now.toISOString() });
  } catch (e) { setBackup({ state: 'failing', reason: reasonOf(e) }); }
  return getOfflineState().backup;
}
export async function resumeBackup(userId: string) {
  try {
    const dir = await readBackupDir(userId);
    if (dir?.requestPermission) await dir.requestPermission({ mode: 'readwrite' });
  } catch (e) { setBackup({ state: 'failing', reason: reasonOf(e) }); return; }
  await runBackup(userId);
}
/** Closing the folder chooser is the cashier changing their mind: no state change, no error message. */
const isChooserCancelled = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

export async function setUpBackup(userId: string) {
  // Native window methods need their receiver: a detached call throws "TypeError: Illegal invocation" in Chrome/Edge.
  let dir: DirHandleLike;
  try {
    dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandleLike> })
      .showDirectoryPicker({ id: 'pharmaxpert-backup', mode: 'readwrite', startIn: 'documents' });
  } catch (e) { if (isChooserCancelled(e)) return getOfflineState().backup; throw e; }
  await rememberBackupDir(userId, dir);
  await getDeviceId();
  return runBackup(userId);
}

/** Debounced writer: 2 s after changes, immediately on `flush`. */
export function createBackupScheduler(run: () => Promise<unknown>, delay = 2000) {
  let timer: ReturnType<typeof setTimeout> | undefined; let busy: Promise<unknown> = Promise.resolve();
  const exec = () => { timer = undefined; busy = busy.then(() => run()).catch(() => {}); return busy; };
  return {
    schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { void exec(); }, delay); },
    flush() { if (timer) clearTimeout(timer); return exec(); },
    cancel() { if (timer) clearTimeout(timer); timer = undefined; },
  };
}
