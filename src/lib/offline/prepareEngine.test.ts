import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { sale } from './rules.test';

// A real mutex standing in for the browser POS lock (checkout, sync and catalog share it).
let chain: Promise<unknown> = Promise.resolve();
let holders = 0; let lockRequests = 0;
const withPosLock = <T,>(work: () => Promise<T>): Promise<T> => {
  lockRequests++;
  const next = chain.then(async () => { holders++; try { return await work(); } finally { holders--; } });
  chain = next.catch(() => undefined);
  return next;
};
mock.module('./network', () => ({
  validSession: async () => true, checkReachability: async () => true,
  callPos: async () => ({ data: null, error: new Error('No test response configured') }),
  withPosLock,
}));
const { offlineDb, writeMeta, readMeta } = await import('./db');
const rc = await import('./readCache');
const { setOfflineState } = await import('./store');
const E = await import('./prepareEngine');
type Def = import('./prepareEngine').DatasetDef;

const flush = (ms = 20) => new Promise(r => setTimeout(r, ms));
const online = () => setOfflineState({ reachable: true, connection: 'online' });
const OWNER = { id: 'user', role: 'owner' };
const STAFF = { id: 'user', role: 'staff', branch_id: 'branch' };
let calls: string[] = [];
const def = (id: string, priority: number, extra: Partial<Def> = {}): Def => ({
  id, label: id, page: 'customers', route: '/', scope: 'branch', priority, saveReads: true, queryKey: id,
  run: async ctx => { calls.push(`${id}@${ctx.target.scopeKey}`); }, ...extra,
});
const run = (registry: Def[], extra: Partial<import('./prepareEngine').RunOptions> = {}) => E.runPreparation({
  userId: 'user', profile: OWNER, activeBranch: null, force: false, signal: new AbortController().signal, registry,
  estimate: async () => ({ usage: 1, quota: 100 }), ...extra,
});
const status = (key: string) => readMeta<import('./prepareEngine').EntryStatus>(E.statusKey('user', key));

beforeEach(async () => {
  await offlineDb.open();
  await Promise.all([offlineDb.sales.clear(), offlineDb.catalog.clear(), offlineDb.meta.clear(), offlineDb.readCache.clear(), offlineDb.ops.clear()]);
  rc.setReadUser('user'); rc.setReadScope('owner-all'); online(); calls = []; lockRequests = 0;
  await writeMeta('subscription:user', { status: 'active', credit: 30 });
  await writeMeta('prepareBranchOrder:user', ['b1', 'b2']);
  E.setPrepareState({ running: false, done: 0, total: 0, entries: [], storageWarning: false });
});
afterAll(async () => { await offlineDb.delete(); });

describe('planning: order and permissions', () => {
  const registry = [
    def('access.profile', 0, { scope: 'user', saveReads: false }),
    def('overview', 4), def('activity', 4, { scope: 'user', saveReads: false }),
    def('customers', 3, { permission: 'customers' }), def('suppliers', 3, { permission: 'suppliers' }),
    def('inventory', 2, { permission: 'inventory' }), def('sales.catalog', 1, { permission: 'sales', perBranchOnly: true }),
    def('leaderboard', 4, { ownerOnly: true }),
  ];
  test('owner: active branch first by priority, then All branches and the other branches; user data once', () => {
    const plan = E.planPreparation({ registry, profile: OWNER, subscriptionOk: true, ownerBranchIds: ['b1', 'b2'], activeBranch: 'b2' });
    expect(plan.map(p => p.key)).toEqual([
      'sales.catalog@b2', 'inventory@b2', 'customers@b2', 'suppliers@b2', 'overview@b2', 'activity@user', 'leaderboard@b2',
      'sales.catalog@b1', 'inventory@owner-all', 'customers@owner-all', 'suppliers@owner-all', 'overview@owner-all', 'leaderboard@owner-all',
      'inventory@b1', 'customers@b1', 'suppliers@b1', 'overview@b1', 'leaderboard@b1',
    ]);
    expect(E.planAccess(registry, OWNER).map(p => p.key)).toEqual(['access.profile@user']);
  });
  test('owner viewing All branches: All branches first, with each branch catalog', () => {
    const plan = E.planPreparation({ registry, profile: OWNER, subscriptionOk: true, ownerBranchIds: ['b1', 'b2'], activeBranch: null });
    expect(plan.slice(0, 3).map(p => p.key)).toEqual(['sales.catalog@b1', 'sales.catalog@b2', 'inventory@owner-all']);
  });
  test('staff without customers permission never plans customers; never-verified permissions deny every page', () => {
    const perms = { sales: 'edit', inventory: 'read', customers: 'no_access', suppliers: 'edit' } as const;
    const plan = E.planPreparation({ registry, profile: STAFF, permissions: perms, subscriptionOk: true, ownerBranchIds: [], activeBranch: 'branch' });
    expect(plan.map(p => p.key)).toEqual(['sales.catalog@branch', 'inventory@branch', 'suppliers@branch', 'overview@branch', 'activity@user']);
    const none = E.planPreparation({ registry, profile: STAFF, permissions: undefined, subscriptionOk: true, ownerBranchIds: [], activeBranch: 'branch' });
    expect(none.map(p => p.key)).toEqual(['overview@branch', 'activity@user']);
    expect(E.planPreparation({ registry, profile: STAFF, permissions: perms, subscriptionOk: false, ownerBranchIds: [], activeBranch: 'branch' })).toEqual([]);
  });
  test('out-of-scope pages are never fetched in a run', async () => {
    await writeMeta('permissions:user', { sales: 'edit', inventory: 'edit', customers: 'no_access', suppliers: 'edit' });
    await run(registry, { profile: STAFF, activeBranch: 'branch' });
    expect(calls.some(c => c.startsWith('customers') || c.startsWith('leaderboard'))).toBe(false);
    expect(calls).toContain('suppliers@branch');
    await writeMeta('subscription:user', { status: 'expired', credit: 0 });
    calls = []; await run(registry, { profile: STAFF, activeBranch: 'branch', force: true });
    expect(calls).toEqual(['access.profile@user']);
  });
});

describe('running quietly', () => {
  test('pauses while checkout holds the POS lock and never holds it across a dataset', async () => {
    let releaseCheckout!: () => void;
    const checkout = withPosLock(() => new Promise<void>(r => { releaseCheckout = r; }));
    const lockedDuringRun: number[] = [];
    const registry = [def('a', 1, { run: async () => { calls.push('a'); lockedDuringRun.push(holders); } }), def('b', 2, { run: async () => { calls.push('b'); lockedDuringRun.push(holders); } })];
    const running = run(registry, { profile: STAFF, activeBranch: 'branch' }); // one scope
    await flush(40);
    expect(calls).toEqual([]);
    releaseCheckout(); await checkout; await running;
    expect(calls).toEqual(['a', 'b']);
    expect(lockedDuringRun).toEqual([0, 0]);
    expect(lockRequests).toBe(3); // checkout + one short yield per entry
  });
  test('stops immediately when offline, records nothing for the interrupted entry, resumes on reconnect', async () => {
    const registry = [def('first', 1), def('drops', 2, { run: async () => { calls.push('drops'); setOfflineState({ reachable: false, connection: 'offline' }); } }), def('later', 3)];
    expect(await run(registry, { activeBranch: 'b1' })).toBe('stopped');
    expect(calls).toEqual(['first@b1', 'drops']);
    expect((await status('first@b1'))?.status).toBe('ready');
    expect(await status('drops@b1')).toBeUndefined();
    expect(await status('later@b1')).toBeUndefined();
    expect(await run(registry, { activeBranch: 'b1' })).toBe('stopped'); // still offline: nothing starts
    online(); calls = [];
    const resumed = [def('first', 1), def('drops', 2), def('later', 3)];
    expect(await run(resumed, { activeBranch: 'b1' })).toBe('completed');
    expect(calls.filter(c => c.endsWith('@b1'))).toEqual(['drops@b1', 'later@b1']); // 'first' stayed fresh
  });
  test('a response finishing after sign-out is never saved, under anyone', async () => {
    let resolveFetch!: (r: Response) => void;
    const cachedFetch = rc.createReadCacheFetch(() => new Promise<Response>(r => { resolveFetch = r; }));
    const registry = [def('customers', 1, { run: async ctx => {
      const pending = cachedFetch('https://db.example.co/rest/v1/customers?select=*', { method: 'GET', signal: ctx.signal });
      await flush(); rc.setReadUser('other');            // signed out; another cashier signs in
      resolveFetch(new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 }));
      await pending;
    } })];
    expect(await run(registry, { activeBranch: 'b1' })).toBe('stopped');
    await flush(40);
    expect(await offlineDb.readCache.count()).toBe(0);
    expect(await status('customers@b1')).toBeUndefined();
  });
  test('cancelling the run aborts the in-flight request and records nothing', async () => {
    const controller = new AbortController();
    const cachedFetch = rc.createReadCacheFetch((_input, init) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const registry = [def('slow', 1, { run: async ctx => { const p = cachedFetch('https://db.example.co/rest/v1/suppliers?select=*', { method: 'GET', signal: ctx.signal }); controller.abort(); await p; } })];
    expect(await run(registry, { activeBranch: 'b1', signal: controller.signal })).toBe('stopped');
    expect(await status('slow@b1')).toBeUndefined();
  });
});

describe('preparation cache binding', () => {
  const URL_ = 'https://db.example.co/rest/v1/customers?select=*&order=name.asc&branch_id=eq.b2';
  test('saves under the prepared branch without changing the visible scope; awaited writes; never serves cache', async () => {
    rc.setReadScope('visible-branch');
    let fail = false;
    const cachedFetch = rc.createReadCacheFetch(async () => { if (fail) throw new TypeError('Failed to fetch'); return new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 }); });
    const controller = new AbortController();
    const binding = rc.bindPrepare(controller.signal, 'user', 'b2');
    await cachedFetch(URL_, { method: 'GET', signal: controller.signal });
    expect(await Promise.all(binding.writes)).toEqual([true]);
    expect(rc.getReadContext().scopeKey).toBe('visible-branch');
    const saved = await offlineDb.readCache.toArray();
    expect(saved.map(r => [r.userId, r.scopeKey, r.queryKey])).toEqual([['user', 'b2', rc.describeRequest(URL_).queryKey]]);
    fail = true;
    await expect(cachedFetch(URL_, { method: 'GET', signal: controller.signal })).rejects.toThrow('Failed to fetch');
    expect([...binding.outcomes.values()].at(-1)?.ok).toBe(false);
  });
  test('an entry whose copy cannot be saved (too large) is failed, not ready', async () => {
    const big = JSON.stringify([{ id: 'x', pad: 'x'.repeat(rc.MAX_ENTRY_BYTES + 10) }]);
    const cachedFetch = rc.createReadCacheFetch(async () => new Response(big, { status: 200 }));
    const registry = [def('huge', 1, { run: async ctx => { await cachedFetch('https://db.example.co/rest/v1/branch_items?select=*', { method: 'GET', signal: ctx.signal }); } })];
    await run(registry, { activeBranch: 'b1' });
    expect(await status('huge@b1')).toMatchObject({ status: 'failed', error: 'Too large to save on this PC' });
  });
  test('an HTTP error or a thrown dataset marks the entry failed and keeps the previous saved time', async () => {
    await writeMeta(E.statusKey('user', 'bad@b1'), { key: 'bad@b1', status: 'ready', savedAt: '2026-10-30T08:00:00.000Z', attemptedAt: '2026-10-30T08:00:00.000Z' });
    const cachedFetch = rc.createReadCacheFetch(async () => new Response('{}', { status: 500 }));
    const registry = [def('bad', 1, { run: async ctx => { await cachedFetch('https://db.example.co/rest/v1/suppliers?select=*', { method: 'GET', signal: ctx.signal }); } }),
      def('throws', 2, { run: async () => { throw new Error('boom'); } })];
    await run(registry, { activeBranch: 'b1', force: true });
    expect(await status('bad@b1')).toMatchObject({ status: 'failed', error: '1 request failed', savedAt: '2026-10-30T08:00:00.000Z' });
    expect(await status('throws@b1')).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('freshness and invalidation', () => {
  const t0 = new Date('2026-10-31T06:00:00Z');
  const at = (hours: number) => () => new Date(t0.getTime() + hours * 3_600_000);
  test('re-prepares after six hours, on forced (reconnect / Prepare now) runs and after own synced changes', async () => {
    const registry = [def('customers', 3), def('activity.feed', 4, { scope: 'user', saveReads: false })];
    await run(registry, { activeBranch: 'b1', now: at(0) });
    const first = calls.length; expect(first).toBeGreaterThan(0);
    calls = []; await run(registry, { activeBranch: 'b1', now: at(5.9) });
    expect(calls).toEqual([]);
    calls = []; await run(registry, { activeBranch: 'b1', now: at(6.1) });
    expect(calls.length).toBe(first);
    calls = []; await run(registry, { activeBranch: 'b1', now: at(6.2), force: true });
    expect(calls.length).toBe(first);
    calls = []; expect(await E.markPrepareDirty('user', ['customers'], ['b1'])).toBe(1);
    await run(registry, { activeBranch: 'b1', now: at(6.3) });
    expect(calls).toEqual(['customers@b1']);
  });
  test('capped entries count as prepared (fresh) but are reported', async () => {
    await run([def('big', 2, { run: async () => ({ rows: 20_000, capped: true }) })], { activeBranch: 'b1' });
    expect(await status('big@b1')).toMatchObject({ status: 'capped', rows: 20_000 });
    expect(E.isFresh(await status('big@b1'), Date.now())).toBe(true);
  });
});

describe('storage', () => {
  test('above 85% of quota, lower-priority datasets stop with a warning; access data and Sales continue', async () => {
    const registry = [def('access.profile', 0, { scope: 'user', saveReads: false }), def('sales.catalog', 1), def('inventory', 2), def('customers', 3)];
    await run(registry, { activeBranch: 'b1', estimate: async () => ({ usage: 90, quota: 100 }) });
    expect(calls.filter(c => c.endsWith('@b1') || c.endsWith('@user'))).toEqual(['access.profile@user', 'sales.catalog@b1']);
    expect((await status('inventory@b1'))?.status).toBe('skipped');
    expect(E.getPrepareState().storageWarning).toBe(true);
    expect(E.indicatorState(E.getPrepareState()).kind).toBe('incomplete');
  });
  test('eviction removes least-recently-used read entries only: never outbox ops, sales, catalog or meta', async () => {
    await offlineDb.sales.add(sale('pending', 'keep'));
    await offlineDb.ops.add({ opId: 'op1', userId: 'user', branchId: 'b1', entityId: 'e', status: 'pending', deviceCreatedAt: '2026-10-31' } as never);
    await offlineDb.catalog.add({ id: 'item', branchId: 'b1', ownerKey: 'user' } as never);
    const metaBefore = await offlineDb.meta.count();
    for (const n of [1, 2, 3, 4]) {
      await rc.saveReadEntry('user', 'b1', rc.describeRequest(`https://db.example.co/rest/v1/customers?select=*&id=eq.${n}`), 200, JSON.stringify([{ id: n, pad: 'x'.repeat(1000) }]), null, new Date(Date.now() + n));
    }
    const result = await rc.enforceReadCacheLimits('user', 2500);
    expect(result.evicted).toBe(2);
    expect(await offlineDb.readCache.count()).toBe(2);
    expect(await offlineDb.sales.count()).toBe(1);
    expect(await offlineDb.ops.count()).toBe(1);
    expect(await offlineDb.catalog.count()).toBe(1);
    expect(await offlineDb.meta.count()).toBe(metaBefore);
    expect(rc.MAX_USER_BYTES).toBe(150 * 1024 * 1024);
  });
});

describe('indicator states', () => {
  const entry = (status: import('./prepareEngine').ShownState, savedAt?: string) => ({ key: status, datasetId: 'd', page: 'customers' as const, label: 'd', scopeKey: 'b1', scope: 'branch' as const, status, savedAt });
  test('preparing shows progress over registry entries', () => {
    expect(E.indicatorState({ running: true, done: 3, total: 8, entries: [], storageWarning: false })).toEqual({ kind: 'preparing', percent: 37 });
  });
  test('ready only when every planned entry is saved; shows the oldest saved time', () => {
    expect(E.indicatorState({ running: false, done: 2, total: 2, storageWarning: false, entries: [entry('ready', '2026-10-31T09:00:00Z'), entry('ready', '2026-10-31T08:00:00Z')] }))
      .toEqual({ kind: 'ready', preparedAt: '2026-10-31T08:00:00Z' });
  });
  test('incomplete when anything failed, was capped, skipped or never saved', () => {
    for (const s of ['failed', 'capped', 'skipped', 'missing'] as const) {
      expect(E.indicatorState({ running: false, done: 0, total: 0, storageWarning: false, entries: [entry('ready', '2026-10-31T08:00:00Z'), entry(s)] }).kind).toBe('incomplete');
    }
    expect(E.indicatorState({ running: false, done: 0, total: 0, storageWarning: false, entries: [] }).kind).toBe('none');
  });
  test('header badge text: ready ✓ with prepared time, preparing NN%, amber incomplete', () => {
    expect(E.indicatorLabel({ kind: 'preparing', percent: 42 })).toEqual({ text: 'Preparing offline data… 42%', tone: 'busy' });
    const ready = E.indicatorLabel({ kind: 'ready', preparedAt: '2026-10-31T08:05:00Z' });
    expect(ready.text).toBe('Offline ready ✓');
    expect(ready.title).toBe(`Prepared ${new Date('2026-10-31T08:05:00Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    expect(E.indicatorLabel({ kind: 'incomplete', reasons: ['failed'] })).toMatchObject({ text: 'Offline data incomplete', tone: 'warn' });
    expect(E.indicatorLabel({ kind: 'none' }).tone).toBe('none');
  });
  test('popover lines show saved time, failure, cap and missing', () => {
    const base = { key: 'k', datasetId: 'd', page: 'customers' as const, label: 'd', scopeKey: 'b1', scope: 'branch' as const };
    const at = '2026-10-31T08:05:00Z'; const hm = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(E.entryStatusText({ ...base, status: 'ready', savedAt: at })).toBe(`saved ${hm}`);
    expect(E.entryStatusText({ ...base, status: 'failed', error: '1 request failed', savedAt: at })).toBe(`failed — 1 request failed (previous copy saved ${hm})`);
    expect(E.entryStatusText({ ...base, status: 'capped', error: 'Only the first 20,000 rows were saved', savedAt: at })).toContain('capped — Only the first 20,000 rows were saved');
    expect(E.entryStatusText({ ...base, status: 'missing' })).toBe('waiting to be prepared');
  });
  test('the run publishes planned entries, including never-saved ones as missing', async () => {
    const registry = [def('ok', 1), def('stops', 2, { run: async () => { setOfflineState({ reachable: false, connection: 'offline' }); } })];
    await run(registry, { activeBranch: 'b1' });
    const entries = E.getPrepareState().entries;
    expect(entries.find(e => e.key === 'ok@b1')?.status).toBe('ready');
    expect(entries.find(e => e.key === 'stops@b1')?.status).toBe('missing');
    expect(E.indicatorState(E.getPrepareState()).kind).toBe('incomplete');
  });
});
