import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeEach, expect, mock, test } from 'bun:test';
import { sale } from './rules.test';
import { offlineDb } from './db';

mock.module('@/lib/db', () => ({ supabase: { supabaseUrl: 'https://session-test.example.com' } }));
const { signOutSession } = await import('./signOut');
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
const storage = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => storage.get(k) ?? null, removeItem: (k: string) => storage.delete(k) } });
beforeEach(async () => {
  await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.catalog.clear(); await offlineDb.meta.clear(); storage.clear();
});
for (const reachable of [true, false]) {
  test(`${reachable ? 'online' : 'offline'} sign-out clears session and retains every sale, catalog and meta`, async () => {
    const records = ['pending', 'syncing', 'needs_attention', 'discarded', 'synced', 'voided'].map((s, i) => sale(s as Parameters<typeof sale>[0], `txn-${i}`));
    await offlineDb.sales.bulkAdd(records);
    await offlineDb.catalog.put({ id: 'item', ownerKey: 'user' } as any);
    const meta = ['profile:user', 'branches:user', 'lastSuccessfulSync:user', 'backupDir:user', 'deviceId'].map(key => ({ key, value: { retained: true } }));
    await offlineDb.meta.bulkPut(meta);
    for (const suffix of ['', '-code-verifier', '-user']) storage.set(`sb-session-test-auth-token${suffix}`, 'session-fixture');
    storage.set('unrelated', 'keep');
    let calls = 0;
    await signOutSession(reachable, async () => { calls++; return { error: null }; });
    expect(calls).toBe(reachable ? 1 : 0);
    expect([...storage.entries()]).toEqual([['unrelated', 'keep']]);
    expect(await offlineDb.sales.toArray()).toEqual(records);
    expect(await offlineDb.catalog.get('item')).toEqual({ id: 'item', ownerKey: 'user' });
    expect(await offlineDb.meta.toArray()).toEqual([...meta].sort((a, b) => a.key.localeCompare(b.key)));
  });
}
test('failed online sign-out retains the persisted session and device sales', async () => {
  storage.set('sb-session-test-auth-token', 'session-fixture');
  await offlineDb.sales.add(sale('pending'));
  await expect(signOutSession(true, async () => ({ error: new Error('Sign-out failed') }))).rejects.toThrow('Sign-out failed');
  expect(storage.has('sb-session-test-auth-token')).toBe(true);
  expect(await offlineDb.sales.count()).toBe(1);
});