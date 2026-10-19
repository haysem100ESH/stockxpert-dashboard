import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, afterAll, expect, mock, test } from 'bun:test';
import { sale } from './rules.test';
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
mock.module('./network', () => ({ validSession: async () => true, checkReachability: async () => true,
  callPos: async () => ({ data: null, error: new Error('none') }),
  withPosLock: (work: () => Promise<unknown>) => new Promise((resolve, reject) => { setTimeout(() => { work().then(resolve, reject); }, 0); }) }));
const { offlineDb } = await import('./db');
const backup = await import('./backup');
const { EXPORT_FIELDS } = await import('./deviceSafety');
const { parseBackup, restoreBackup, previewBackup, OTHER_CASHIER } = await import('./restore');
const { getOfflineState, setOfflineState } = await import('./store');

class FakeDir {
  files = new Map<string, string>(); permission: PermissionState = 'granted'; failWrites = false;
  async getFileHandle(name: string) { return { createWritable: async () => { let buf = '';
    return { write: async (d: string) => { if (this.failWrites) throw new Error('disk full'); buf += d; }, close: async () => { this.files.set(name, buf); }, abort: async () => {} }; } }; }
  async removeEntry(name: string) { this.files.delete(name); }
  async *keys() { for (const k of [...this.files.keys()]) yield k; }
  async queryPermission() { return this.permission; }
}
beforeEach(async () => { await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear(); });
afterAll(async () => { await offlineDb.delete(); });

test('backup includes unresolved + retained synced for this user only, allowlisted fields only', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  const recent = { ...sale('synced', 's1'), syncedAt: '2026-10-18T10:00:00Z' };
  const old = { ...sale('synced', 's2'), syncedAt: '2026-08-01T10:00:00Z' };
  const records = [sale('pending', 'p'), sale('syncing', 'y'), sale('needs_attention', 'n'), sale('discarded', 'd'), recent, old,
    sale('voided', 'v'), { ...sale('pending', 'x'), userId: 'other' }];
  Object.assign(records[0], { access_token: 'secret', creditScore: 5, nextAttemptAt: 1 });
  const doc = backup.buildBackupDocument(records, 'user', 'dev1', now);
  expect(doc).toMatchObject({ format: 'pharmaxpert-backup', version: 1, userId: 'user', deviceId: 'dev1', generatedAt: now.toISOString() });
  expect(doc.sales.map(r => r.clientTxnId)).toEqual(['p', 'y', 'n', 'd', 's1']);
  for (const r of doc.sales) expect(Object.keys(r).every(k => (EXPORT_FIELDS as readonly string[]).includes(k))).toBe(true);
  expect(JSON.stringify(doc)).not.toContain('secret');
});
test('latest + dated naming (Addis date) and pruning to 7 touches only its own prefix', async () => {
  const dir = new FakeDir();
  const prefix = backup.backupPrefix('user-1234-abcd', 'dev1');
  expect(prefix).toBe('pharmaxpert-backup-user-123-dev1-');
  for (let d = 1; d <= 9; d++) dir.files.set(`${prefix}2026-10-0${d}.json`, 'old');
  dir.files.set('pharmaxpert-backup-other123-dev1-2026-01-01.json', 'other user');
  dir.files.set('pharmaxpert-backup-user-123-dev2-2026-01-01.json', 'other device');
  dir.files.set('notes.txt', 'keep');
  const now = new Date('2026-10-19T22:30:00Z'); // 01:30 on 20 Oct in Addis Ababa
  await backup.writeBackupFiles(dir, backup.buildBackupDocument([], 'user-1234-abcd', 'dev1', now), now);
  expect(dir.files.has(`${prefix}latest.json`)).toBe(true);
  expect(dir.files.has(`${prefix}2026-10-20.json`)).toBe(true);
  const dated = [...dir.files.keys()].filter(k => k.startsWith(prefix) && k !== `${prefix}latest.json`).sort();
  expect(dated).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-20'].map(d => `${prefix}${d}.json`));
  expect(dir.files.has('pharmaxpert-backup-other123-dev1-2026-01-01.json')).toBe(true);
  expect(dir.files.has('pharmaxpert-backup-user-123-dev2-2026-01-01.json')).toBe(true);
  expect(dir.files.has('notes.txt')).toBe(true);
});
test('runBackup never throws: write failure, paused permission, not set up', async () => {
  expect((await backup.runBackup('user')).state).toBe('not_set_up');
  const dir = new FakeDir(); dir.failWrites = true;
  await backup.rememberBackupDir('user', dir);
  await offlineDb.sales.add(sale('pending'));
  expect(await backup.runBackup('user')).toEqual({ state: 'failing', reason: 'disk full' });
  expect((await offlineDb.sales.get('txn'))?.status).toBe('pending');
  dir.permission = 'prompt';
  expect((await backup.runBackup('user')).state).toBe('paused');
  dir.permission = 'granted'; dir.failWrites = false;
  expect((await backup.runBackup('user')).state).toBe('ok');
});
test('scheduler debounces and flushes immediately', async () => {
  let runs = 0; const s = backup.createBackupScheduler(async () => { runs++; }, 20);
  s.schedule(); s.schedule(); s.schedule();
  await new Promise(r => setTimeout(r, 60)); expect(runs).toBe(1);
  s.schedule(); await s.flush(); expect(runs).toBe(2);
  await new Promise(r => setTimeout(r, 40)); expect(runs).toBe(2);
});
const fileFor = (sales: unknown[], userId = 'user', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'pharmaxpert-backup', version: 1, userId, deviceId: 'dev1', generatedAt: '2026-10-19T10:00:00Z', sales, ...extra });
test('restore rejects another cashier, malformed file and wrong version', () => {
  expect(() => parseBackup(fileFor([], 'other'), 'user')).toThrow(OTHER_CASHIER);
  expect(() => parseBackup('{not json', 'user')).toThrow('not a valid backup');
  expect(() => parseBackup(JSON.stringify({ format: 'x' }), 'user')).toThrow('not a PharmaXpert backup');
  expect(() => parseBackup(fileFor([], 'user', { version: 2 }), 'user')).toThrow('Unsupported backup version');
  expect(() => parseBackup(fileFor([], 'user', { sales: undefined }), 'user')).toThrow('missing required fields');
});
test('restore skips existing ids, keeps payloads identical, maps statuses, reports counts', async () => {
  await offlineDb.sales.add(sale('pending', 'exists'));
  const withIssue = { ...sale('needs_attention', 'n'), issueId: 'issue-1' };
  const discarded = { ...sale('discarded', 'd'), discardNote: 'reviewed', discardedBy: 'user', discardedAt: '2026-10-19T09:00:00Z' };
  const sales = [sale('pending', 'exists'), sale('syncing', 'y'), withIssue, discarded, { ...sale('synced', 's'), syncedAt: '2026-10-19T09:00:00Z' },
    { clientTxnId: 'bad' }, { ...sale('pending', 'mismatch'), userId: 'other' }];
  const doc = parseBackup(fileFor(sales), 'user');
  expect(previewBackup(doc)).toMatchObject({ count: 7, total: 100 });
  expect(await restoreBackup(doc, 'user')).toEqual({ restored: 3, present: 1, skippedSynced: 1, invalid: 2 });
  const y = await offlineDb.sales.get('y'); const n = await offlineDb.sales.get('n'); const d = await offlineDb.sales.get('d');
  expect(y?.status).toBe('pending'); expect(JSON.stringify(y?.payload)).toBe(JSON.stringify(sales[1] && (sales[1] as { payload: unknown }).payload));
  expect(n?.status).toBe('pending'); expect(n?.issueId).toBe('issue-1');
  expect(d?.status).toBe('discarded'); expect(d?.discardNote).toBe('reviewed');
  expect(await offlineDb.sales.get('s')).toBeUndefined();
  expect(await offlineDb.sales.get('bad')).toBeUndefined();
  expect(await offlineDb.sales.count()).toBe(4);
});
// Chrome/Edge throw "TypeError: Illegal invocation" when a native window method is called without window as receiver.
function windowWithPicker(pick: (options: unknown) => Promise<DirHandleLike>) {
  const win: Record<string, unknown> = {};
  win.showDirectoryPicker = function (this: unknown, options: unknown) {
    if (this !== win) throw new TypeError('Illegal invocation');
    return pick(options);
  };
  return win;
}
async function withFakeWindow<T>(win: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const had = 'window' in g; const original = g.window;
  g.window = win;
  try { return await work(); } finally { if (had) g.window = original; else delete g.window; }
}
test('setUpBackup calls showDirectoryPicker with window as its receiver', async () => {
  const dir = new FakeDir(); const seen: unknown[] = [];
  const win = windowWithPicker(options => { seen.push(options); return Promise.resolve(dir); });
  const status = await withFakeWindow(win, () => backup.setUpBackup('user'));
  expect(seen).toEqual([{ id: 'pharmaxpert-backup', mode: 'readwrite', startIn: 'documents' }]);
  expect(status.state).toBe('ok');
  expect(await backup.readBackupDir('user')).toBe(dir);
  expect([...dir.files.keys()].some(n => n.endsWith('latest.json'))).toBe(true);
});
test('cancelling the folder chooser keeps the backup state and stores nothing', async () => {
  setOfflineState({ backup: { state: 'paused' } });
  const win = windowWithPicker(() => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')));
  const status = await withFakeWindow(win, () => backup.setUpBackup('user'));
  expect(status).toEqual({ state: 'paused' });
  expect(getOfflineState().backup).toEqual({ state: 'paused' });
  expect(await backup.readBackupDir('user')).toBeUndefined();
});
