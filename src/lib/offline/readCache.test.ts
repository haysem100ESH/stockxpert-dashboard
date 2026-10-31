import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { sale } from './rules.test';
Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
mock.module('./network', () => ({
  validSession: async () => true, checkReachability: async () => true,
  callPos: async () => ({ data: null, error: new Error('No test response configured') }),
  withPosLock: (work: () => Promise<unknown>) => new Promise((resolve, reject) => { setTimeout(() => { work().then(resolve, reject); }, 0); }),
}));
const { offlineDb, OfflineDatabase, writeMeta } = await import('./db');
const rc = await import('./readCache');
const { setOfflineState } = await import('./store');
const { clearUserDeviceData, exportFingerprint, userSales } = await import('./deviceSafety');
const { signOutSession } = await import('./signOut');
const { loadOfflineSubscription, loadOfflinePermissions, loadOfflineBranches } = await import('./gates');
const { offlineRouteMode, isWriteControl } = await import('./offlinePages');
const { applyReservations, isExpiredOn, isExpiringSoonOn } = await import('./rules');
const { branchReservations } = await import('./queue');
const { addisDayString } = await import('../timezone');

const REST = 'https://db.example.co/rest/v1';
const flush = () => new Promise(r => setTimeout(r, 30));
let calls = 0;
let mode: 'ok' | 'throw' | 'error' = 'ok';
let body: unknown = [];
const base = async (input: RequestInfo | URL) => {
  calls++;
  if (mode === 'throw') throw new TypeError('Failed to fetch');
  if (mode === 'error') return new Response(JSON.stringify({ message: 'denied' }), { status: 401 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-range': '0-0/*', 'x-url': String(input) } });
};
const cachedFetch = rc.createReadCacheFetch(base);
const get = async (url: string, headers?: Record<string, string>) => {
  const res = await cachedFetch(url, { method: 'GET', headers });
  return { status: res.status, json: await res.json().catch(() => null), cache: res.headers.get('x-offline-cache') };
};
const online = () => setOfflineState({ reachable: true, connection: 'online' });
const offline = () => setOfflineState({ reachable: false, connection: 'offline' });

beforeEach(async () => {
  await offlineDb.open();
  await Promise.all([offlineDb.sales.clear(), offlineDb.catalog.clear(), offlineDb.meta.clear(), offlineDb.readCache.clear(), offlineDb.ops.clear()]);
  rc.setReadUser('user'); rc.setReadScope('branch'); rc.resetReadStatus(); online(); mode = 'ok'; calls = 0; body = [];
});
afterAll(async () => { await offlineDb.delete(); });

const PAGE_DATASETS: Record<string, string> = {
  overview: `${REST}/sales?select=total_amount,sale_date&branch_id=eq.branch&sale_date=gte.${addisDayString()}`,
  inventory: `${REST}/branch_items?select=id,medicine_id,branch_id,quantity,expiry_date&branch_id=in.(branch)&order=created_at.desc&offset=0&limit=24`,
  medicineCodes: `${REST}/medicine_codes?select=*&owner_id=eq.owner&order=code.asc`,
  customers: `${REST}/customers?select=*&branch_id=eq.branch&order=name.asc`,
  suppliers: `${REST}/suppliers?select=*&order=name`,
  account: `${REST}/profiles?select=*&id=eq.user`,
  activity: `${REST}/activity_log?select=*&user_id=eq.user&order=created_at.desc&limit=50`,
};

describe('shared read cache', () => {
  for (const [page, url] of Object.entries(PAGE_DATASETS)) {
    test(`${page}: cached online, served offline, survives Dexie close/reopen`, async () => {
      body = [{ id: `${page}-1`, name: page }];
      expect((await get(url)).cache).toBeNull();
      await flush();
      offlineDb.close();
      await new OfflineDatabase().open().then(db => db.close());
      await offlineDb.open();
      offline();
      const before = calls;
      const hit = await get(url);
      expect(calls).toBe(before);
      expect(hit.cache).toBe('1');
      expect(hit.json).toEqual([{ id: `${page}-1`, name: page }]);
    });
  }
  test('network failure while "reachable" serves the cache too', async () => {
    body = [{ id: 'c1' }]; await get(PAGE_DATASETS.customers); await flush();
    mode = 'throw';
    expect((await get(PAGE_DATASETS.customers)).json).toEqual([{ id: 'c1' }]);
  });
  test('never served to another user', async () => {
    body = [{ id: 'secret-row' }]; await get(PAGE_DATASETS.customers); await flush();
    rc.setReadUser('other'); offline();
    await expect(cachedFetch(PAGE_DATASETS.customers, { method: 'GET' })).rejects.toThrow('not saved');
    expect(await offlineDb.readCache.where('userId').equals('other').count()).toBe(0);
  });
  test('failed fetch (HTTP error or throw) never overwrites the cache', async () => {
    body = [{ id: 'good' }]; await get(PAGE_DATASETS.suppliers); await flush();
    mode = 'error'; expect((await get(PAGE_DATASETS.suppliers)).status).toBe(401); await flush();
    mode = 'throw'; await get(PAGE_DATASETS.suppliers); await flush();
    offline();
    expect((await get(PAGE_DATASETS.suppliers)).json).toEqual([{ id: 'good' }]);
  });
  test('secrets are never stored (gemini_api_key etc.)', async () => {
    body = [{ id: 'user', full_name: 'Abebe', gemini_api_key: 'AIza-SECRET', security_answer_hash: 'h', nested: { access_token: 't' } }];
    await get(PAGE_DATASETS.account); await flush();
    const rows = await offlineDb.readCache.toArray();
    expect(rows.length).toBe(1);
    expect(rows[0].data).not.toContain('gemini_api_key');
    expect(rows[0].data).not.toContain('AIza-SECRET');
    expect(rows[0].data).not.toContain('access_token');
    expect(JSON.parse(rows[0].data)[0].full_name).toBe('Abebe');
  });
  test('writes, RPCs and other branch scopes are not served', async () => {
    body = [{ id: 'x' }];
    await cachedFetch(`${REST}/customers`, { method: 'POST', body: '{}' });
    await cachedFetch(`${REST}/rpc/process_pos_sale`, { method: 'POST', body: '{}' });
    await flush();
    expect(await offlineDb.readCache.count()).toBe(0);
    await get(PAGE_DATASETS.customers); await flush();
    rc.setReadScope('branch-2'); offline();
    await expect(cachedFetch(PAGE_DATASETS.customers, { method: 'GET' })).rejects.toThrow();
  });
  test('local search/filter/sort/pagination on a cached full list keeps the server shape', async () => {
    body = [{ id: 1, name: 'Paracetamol', phone: '0911', debt: 5 }, { id: 2, name: 'amoxicillin', phone: '0922', debt: 0 }, { id: 3, name: 'Aspirin', phone: null, debt: 9 }];
    await get(`${REST}/customers?select=*&branch_id=eq.branch`); await flush();
    offline();
    const search = await get(`${REST}/customers?select=*&branch_id=eq.branch&or=(name.ilike.*a*,phone.ilike.*a*)&debt=gt.0&order=debt.desc&offset=0&limit=1`, { Prefer: 'count=exact' });
    expect(search.json).toEqual([{ id: 3, name: 'Aspirin', phone: null, debt: 9 }]);
    const res = await cachedFetch(`${REST}/customers?select=*&branch_id=eq.branch&debt=gt.0&order=debt.desc&offset=0&limit=1`, { method: 'GET', headers: { Prefer: 'count=exact' } });
    expect(res.headers.get('content-range')).toBe('0-0/2');
    const single = await get(`${REST}/customers?select=*&branch_id=eq.branch&id=eq.2`, { Accept: 'application/vnd.pgrst.object+json' });
    expect(single.json).toEqual({ id: 2, name: 'amoxicillin', phone: '0922', debt: 0 });
  });
  test('date-ranged queries older than 30 days are not cached; cached dated entries expire after 30 days', async () => {
    await get(`${REST}/sales?select=*&sale_date=gte.2020-01-01&sale_date=lte.2020-01-31`); await flush();
    expect(await offlineDb.readCache.count()).toBe(0);
    await get(PAGE_DATASETS.overview); await flush();
    expect(await offlineDb.readCache.count()).toBe(1);
    await rc.enforceReadCacheLimits('user', rc.MAX_USER_BYTES, Date.now() + 31 * 86_400_000);
    expect(await offlineDb.readCache.count()).toBe(0);
  });
  test('size cap evicts least-recently-used entries only, never sales', async () => {
    await offlineDb.sales.add(sale('pending', 'keep'));
    for (const n of [1, 2, 3]) { body = [{ id: n, pad: 'x'.repeat(1000) }]; await get(`${REST}/suppliers?select=*&id=eq.${n}`); await flush(); }
    const old = await offlineDb.readCache.where('userId').equals('user').toArray();
    const lru = old.find(r => r.queryKey.includes('id=eq.1'))!;
    await offlineDb.readCache.update([lru.userId, lru.scopeKey, lru.queryKey], { lastUsedAt: 1 });
    const result = await rc.enforceReadCacheLimits('user', 2500);
    expect(result.evicted).toBe(1);
    const left = (await offlineDb.readCache.toArray()).map(r => r.queryKey);
    expect(left.some(k => k.includes('id=eq.1'))).toBe(false);
    expect(await offlineDb.sales.count()).toBe(1);
    // Phase 4 Feature A: per-user read budget raised from 25 MB to 150 MB.
    expect(rc.MAX_USER_BYTES).toBe(150 * 1024 * 1024);
  });
  test('"Remove my data" clears this user\'s read cache only; sign-out keeps it', async () => {
    await get(PAGE_DATASETS.customers); await flush();
    rc.setReadUser('other'); await get(PAGE_DATASETS.customers); await flush(); rc.setReadUser('user');
    (globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, removeItem: () => undefined };
    await signOutSession(true, async () => undefined).catch(() => undefined);
    expect(await offlineDb.readCache.count()).toBe(2);
    await clearUserDeviceData('user', exportFingerprint(await userSales('user')));
    expect(await offlineDb.readCache.where('userId').equals('user').count()).toBe(0);
    expect(await offlineDb.readCache.where('userId').equals('other').count()).toBe(1);
  });
});

describe('offline gates fail closed', () => {
  test('uncached subscription/permissions/branches are denied', async () => {
    expect((await loadOfflineSubscription('user')).status).toBe('uncached');
    const perms = await loadOfflinePermissions('user', { sales: 'no_access' });
    expect(perms).toEqual({ permissions: { sales: 'no_access' }, uncached: true });
    expect((await loadOfflineBranches('user')).uncached).toBe(true);
  });
  test('cached values are honoured exactly; expired stays blocked', async () => {
    await writeMeta('subscription:user', { status: 'expired', credit: 0 });
    await writeMeta('permissions:user', { sales: 'edit', finance: 'no_access' });
    expect((await loadOfflineSubscription('user')).status).toBe('expired');
    expect((await loadOfflinePermissions('user', {})).permissions).toEqual({ sales: 'edit', finance: 'no_access' });
    expect((await loadOfflineSubscription('other')).status).toBe('uncached');
  });
  test('owner branch selector offline: only allowed branches, unopened ones unavailable', async () => {
    await writeMeta('branchDetails:user', [{ id: 'branch', name: 'A', is_main_branch: true, branch_type: 'pharmacy' }, { id: 'b2', name: 'B', is_main_branch: false, branch_type: 'pharmacy' }, { id: 'foreign', name: 'X', is_main_branch: false, branch_type: 'pharmacy' }]);
    await writeMeta('branches:user', ['branch', 'b2']);
    await get(PAGE_DATASETS.customers); await flush();
    const result = await loadOfflineBranches('user');
    expect(result.branches.map(b => [b.id, b.available])).toEqual([['branch', true], ['b2', false]]);
    expect(result.allAvailable).toBe(false);
  });
});

describe('offline pages', () => {
  test('out-of-scope routes are online-only; in-scope cached; Sales/Activity keep their own offline mode', () => {
    for (const r of ['/finance', '/staff', '/branches', '/stock-movements', '/transfer-requests', '/smart-inventory', '/sync-issues', '/developer']) expect(offlineRouteMode(r)).toBe('online-only');
    for (const r of ['/', '/inventory', '/medicine-codes', '/customers', '/suppliers', '/account']) expect(offlineRouteMode(r)).toBe('cached');
    for (const r of ['/sales', '/activity', '/owner/activity']) expect(offlineRouteMode(r)).toBe('own');
  });
  const writes: Record<string, string[]> = {
    overview: ['Mark as disposed', 'Send test message', 'Write off'],
    inventory: ['Add Item', 'Edit', 'Delete', 'Import CSV', 'Adjust Stock', 'Open pack'],
    medicineCodes: ['New Code', 'Save changes', 'Delete code'],
    customers: ['Add Customer', 'Record Payment', 'Update customer'],
    suppliers: ['Add Supplier', 'Record Purchase', 'Pay supplier'],
    account: ['Change Password', 'Update Email', 'Save Profile'],
  };
  for (const [page, labels] of Object.entries(writes)) test(`${page}: write controls are classified as needing internet`, () => {
    for (const text of labels) expect(isWriteControl({ text })).toBe(true);
  });
  test('submit buttons, switches and icon-only add/delete buttons are writes; navigation is not', () => {
    expect(isWriteControl({ text: 'OK', type: 'submit' })).toBe(true);
    expect(isWriteControl({ text: '', role: 'switch' })).toBe(true);
    expect(isWriteControl({ text: '', icons: 'lucide lucide-trash-2' })).toBe(true);
    for (const text of ['View details', 'Next', 'Previous', 'Search', 'Close', 'Cancel', 'Export CSV', 'Customers', 'All categories']) expect(isWriteControl({ text })).toBe(false);
  });
});

describe('offline inventory', () => {
  test('stock subtracts unsynced sales of all cashiers in that branch only', async () => {
    await offlineDb.sales.bulkAdd([sale('pending', 'a'), { ...sale('needs_attention', 'b'), userId: 'other' }, sale('synced', 'c'), { ...sale('pending', 'd'), branchId: 'branch-y', payload: { ...sale('pending', 'd').payload, branch_id: 'branch-y' } }]);
    const records = await branchReservations(['branch']);
    const [item] = applyReservations([{ id: 'item', quantity: 10 }], records);
    expect(item.quantity).toBe(6); // two reserving sales × base_quantity 2; synced and other branch ignored
  });
  test('expiry is recomputed from the Addis date', () => {
    expect(isExpiredOn('2026-10-28', '2026-10-28')).toBe(true);
    expect(isExpiredOn('2026-10-29', '2026-10-28')).toBe(false);
    expect(isExpiringSoonOn('2026-11-20', '2026-10-28')).toBe(true);
    expect(isExpiringSoonOn('2026-12-20', '2026-10-28')).toBe(false);
    expect(addisDayString(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29');
  });
});
