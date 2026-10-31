/**
 * Isolated DOM check (run by OfflinePrepare.test.ts, one process per role):
 *  1. Parity: render each in-scope page ONLINE from an empty cache and record every table read
 *     it makes; run preparation from an empty cache and record its reads. Every page read must
 *     be one preparation produced (same request descriptor = same read-cache key).
 *  2. Offline: after preparation only (pages never opened online), render each page OFFLINE:
 *     no network call, no "not saved" miss, and the prepared data is shown.
 * Uses the real client, read cache, registry and page components; only `fetch`, identity hooks
 * and toasts are simulated. Not a device or authenticated-server verification.
 */
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { strict as assert } from 'node:assert';
import { mock } from 'bun:test';

const ROLE = (process.env.PREP_ROLE ?? 'staff') as 'staff' | 'owner';
const dom = new Window({ url: 'http://localhost:8080/' });
for (const key of ['dispatchEvent', 'addEventListener', 'removeEventListener']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: Reflect.get(dom, key).bind(dom) });
}
for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'MutationObserver', 'ResizeObserver', 'Event', 'MouseEvent', 'CustomEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'DocumentFragment', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'SVGElement', 'DOMRect']) {
  const value = key === 'window' ? dom : Reflect.get(dom, key);
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(dom) : value });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
Object.defineProperty(dom.navigator, 'onLine', { configurable: true, get: () => online });
let online = true;

// ---------- identity (simulated) ----------
const OWNER_ID = ROLE === 'owner' ? 'user' : 'owner';
const profile = ROLE === 'owner'
  ? { id: 'user', full_name: 'Owner', role: 'owner', branch_id: null, active: true }
  : { id: 'user', full_name: 'Cashier', role: 'staff', branch_id: 'b1', active: true };
const selectedBranch = ROLE === 'owner' ? null : 'b1';
// Stable like the real provider's state (hooks depend on [user] / [profile]).
const auth = { user: { id: 'user' }, profile, loading: false };
const branchContext = { selectedBranch, userBranch: ROLE === 'staff' ? 'b1' : null, branchType: 'pharmacy', setSelectedBranch: () => {} };
mock.module('@/hooks/useAuth', () => ({
  useAuth: () => auth,
  fetchProfileRow: (id: string, signal?: AbortSignal) => {
    const q = db.from('profiles').select('*').eq('id', id).single();
    return signal ? q.abortSignal(signal) : q;
  },
  cacheProfileMeta: async (id: string, data: Record<string, unknown>) => { await writeMeta(`profile:${id}`, { id, role: data.role, branch_id: data.branch_id }); },
}));
mock.module('@/hooks/useBranchContext', () => ({ useBranchContext: () => branchContext }));
mock.module('@/hooks/useStaffPermissions', () => ({
  useStaffPermissions: () => ({ getPermission: () => 'edit', getPermissionForRoute: () => 'edit', canAccess: () => true, isReadOnly: () => false, loading: false, uncachedOffline: false }),
  fetchAndCacheStaffPermissions: async (staffId: string) => { const all = { dashboard: 'edit', inventory: 'edit', sales: 'edit', customers: 'edit', suppliers: 'edit', account: 'edit' }; await writeMeta(`permissions:${staffId}`, all); return all; },
  getPageNameForRoute: () => undefined,
}));
mock.module('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }), toast: () => {} }));
if (ROLE === 'staff') {
  // The real hook returns a new [] on every render for non-owners, which makes useSeasonalPerformance
  // refetch in a loop on Overview (existing app behaviour, reported separately). Staff never use
  // owner branch IDs, so a stable empty list keeps this check finite without changing any request.
  const NONE: string[] = [];
  mock.module('@/hooks/useOwnerBranchIds', () => ({
    useOwnerBranchIds: () => ({ branchIds: NONE, isLoading: false, refetch: async () => undefined }),
    OWNER_BRANCH_IDS_KEY: (ownerId?: string) => ['owner-branch-ids', ownerId],
    fetchOwnerBranchIds: async () => { throw new Error('Owner branch IDs are never requested for staff'); },
  }));
}

// ---------- server (simulated fetch) ----------
const today = new Date().toISOString().slice(0, 10);
const BRANCHES = [
  { id: 'b1', name: 'Main', is_main_branch: true, branch_type: 'pharmacy', pharmacy_owner_id: OWNER_ID, created_at: '2025-01-01' },
  { id: 'b2', name: 'Second', is_main_branch: false, branch_type: 'pharmacy', pharmacy_owner_id: OWNER_ID, created_at: '2025-02-01' },
];
const items = Array.from({ length: 30 }, (_, i) => ({ id: `bi${i}`, medicine_id: `m${i % 26}`, branch_id: i < 28 ? 'b1' : 'b2', owner_id: OWNER_ID,
  selling_price: 10, purchase_price: 6, quantity: i % 7, expiry_date: '2027-01-01', created_at: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}`,
  medicines: { name: `Med ${i % 26}`, category: 'Tablets', minimum_stock_level: 3, item_type: 'medicine', lead_time_days: 3 } }));
const TABLES: Record<string, Record<string, unknown>[]> = {
  profiles: [{ ...profile }],
  staff_permissions: [],
  pharmacy_branches: BRANCHES,
  pharmacy_subscriptions: [{ pharmacy_owner_id: OWNER_ID, status: 'active', subscription_credit: 30 }],
  branch_items: items,
  medicines: Array.from({ length: 26 }, (_, i) => ({ id: `m${i}`, name: `Med ${i}`, category: 'Tablets', minimum_stock_level: 3, medicine_code_id: i === 1 ? 'mc1' : null })),
  medicine_packaging: [{ medicine_id: 'm1', unit_name: 'tablet', pack_enabled: true, pack_name: 'box' }],
  medicine_active_ingredients: [{ medicine_id: 'm1', ingredient_name: 'Paracetamol', strength: '500mg', sort_order: 1 }],
  inventory_batches: [{ id: 'bt1', branch_item_id: 'bi1', medicine_id: 'm1', branch_id: 'b1', remaining_quantity: 4, expiry_date: '2027-01-01', created_at: '2026-01-01', medicines: { name: 'Med 1', category: 'Tablets' } }],
  custom_categories: [{ id: 'cat1', name: 'Tablets', system_type: 'pharmacy', owner_id: OWNER_ID }],
  medicine_groups: [{ id: 'g1', name: 'Analgesics', is_default: true, owner_id: null }],
  medicine_codes: [{ id: 'mc1', owner_id: OWNER_ID, code: 'MC-1', label: 'Pain relief', notes: null, created_at: '2026-01-01', updated_at: '2026-01-01' }],
  customers: [{ id: 'c1', name: 'Customer One', phone: '0911', branch_id: 'b1', credit_score: 60, created_at: '2026-01-01' }],
  customer_credits: [], credit_logs: [],
  suppliers: [{ id: 's1', name: 'Abebe Pharma', contact_person: 'Abebe', branch_id: 'b1', created_at: '2026-01-01' }],
  supplier_debts: [{ supplier_id: 's1', total_debt: 5 }],
  sales: [{ id: 'sale1', branch_id: 'b1', total_amount: 120, extra_profit: 0, sale_date: today, created_at: `${today}T08:00:00Z`, payment_method: 'Cash', discount_amount: 0, customer_id: null, sale_items: [] }],
  sale_items: [], expenses: [], activity_log: [], staff_goals: [], staff_goal_assignments: [], staff_goal_completions: [],
};
const CONTROL = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
const requests: { method: string; url: string; headers: Headers }[] = [];
let networkCalls = 0;
const respond = (body: unknown, status = 200, range = '0-0/*') => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'content-range': range } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  networkCalls++;
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  requests.push({ method, url: url.href, headers });
  if (!online) throw new TypeError('Failed to fetch'); // the network is down
  if (url.pathname.includes('/rpc/')) return respond([]);
  if (!url.pathname.includes('/rest/v1/')) return respond({});
  const table = url.pathname.split('/rest/v1/')[1];
  let rows = [...(TABLES[table] ?? [])];
  for (const [k, v] of url.searchParams.entries()) {
    if (CONTROL.has(k) || k.includes('.')) continue;
    if (k !== 'or' && k !== 'and' && !rows.some(r => k in r)) continue;
    const pred = rc.compileCondition(k, v);
    if (pred) rows = rows.filter(pred);
  }
  const total = rows.length;
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = url.searchParams.get('limit');
  rows = rows.slice(offset, limit ? offset + Number(limit) : undefined);
  const range = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
  if (method === 'HEAD') return respond(null, 200, range);
  if ((headers.get('accept') ?? '').includes('vnd.pgrst.object')) return rows.length === 1 ? respond(rows[0], 200, range) : respond({ code: 'PGRST116', message: 'not one row' }, 406);
  return respond(rows, 200, range);
}) as typeof fetch;

// ---------- app modules (real) ----------
const { supabase: db } = await import('@/lib/db');
const realtime = { on() { return realtime; }, subscribe() { return realtime; } };
Object.assign(db, { channel: () => realtime, removeChannel: () => {} }); // no websockets in this check
const rc = await import('@/lib/offline/readCache');
const { offlineDb, writeMeta } = await import('@/lib/offline/db');
const { setOfflineState } = await import('@/lib/offline/store');
const prep = await import('@/lib/offline/prepare');
const React = await import('react'); const { act } = React;
const { createRoot } = await import('react-dom/client'); const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: Guard } = await import('@/components/offline/OfflineReadGuard');
const { NOT_CACHED } = await import('@/lib/offline/offlinePages');
const pages: { route: string; expect: string; Component: React.ComponentType }[] = [
  { route: '/suppliers', expect: 'Abebe Pharma', Component: (await import('@/components/suppliers/SupplierManagement')).default },
  { route: '/customers', expect: 'Customer One', Component: (await import('@/components/customers/CustomerManagement')).default },
  { route: '/inventory', expect: 'Med 1', Component: (await import('@/components/inventory/StaffInventoryWithActions')).default },
  { route: '/medicine-codes', expect: 'MC-1', Component: (await import('@/components/inventory/MedicineCodes')).default },
  { route: '/', expect: '', Component: (await import('@/pages/Dashboard')).default },
  { route: '/activity', expect: 'Activity Center', Component: (await import('@/pages/ActivityCenterPage')).default },
  ...(ROLE === 'owner' ? [{ route: '/owner/activity', expect: 'Activity Center', Component: (await import('@/pages/OwnerActivityCenterPage')).default }] : []),
];

const host = document.createElement('div'); document.body.append(host);
const settle = async (ms = 120) => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, ms / 6)); }); };
// checkReachability()'s probe always bypasses the read cache by design; it is not page data.
const REACHABILITY_PROBE = rc.describeRequest('https://x.supabase.co/rest/v1/pharmacy_branches?select=id&limit=1').queryKey;
const tableReads = (from: number) => new Set(requests.slice(from)
  .filter(r => (r.method === 'GET' || r.method === 'HEAD') && r.url.includes('/rest/v1/') && !r.url.includes('/rest/v1/rpc/'))
  .map(r => rc.describeRequest(r.url, r.method, r.headers).queryKey)
  .filter(k => ROLE === 'staff' || k !== REACHABILITY_PROBE));
async function renderPage(page: typeof pages[number]) {
  window.history.pushState({}, '', page.route);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });
  const root = createRoot(host);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[page.route]}><QueryClientProvider client={qc}>
      <main>{page.route === '/activity' || page.route === '/owner/activity' ? <page.Component /> : <Guard><page.Component /></Guard>}</main>
    </QueryClientProvider></MemoryRouter>));
  await settle(400);
  const text = host.textContent ?? '';
  await act(async () => root.unmount()); qc.clear();
  return text;
}
async function resetDevice() {
  await offlineDb.open();
  await Promise.all([offlineDb.sales.clear(), offlineDb.catalog.clear(), offlineDb.meta.clear(), offlineDb.readCache.clear(), offlineDb.ops.clear()]);
}

try {
  rc.setReadUser('user');
  rc.setReadScope(selectedBranch ?? 'owner-all');
  setOfflineState({ reachable: true, connection: 'online', records: [], ops: [] });

  // 1) Page reads online, from an empty device.
  await resetDevice();
  await writeMeta('branches:user', ROLE === 'owner' ? ['b1', 'b2'] : ['b1']);
  const pageReads = new Map<string, Set<string>>();
  for (const page of pages) { const start = requests.length; await renderPage(page); pageReads.set(page.route, tableReads(start)); }

  // 2) Preparation alone, from an empty device (pages never opened).
  await resetDevice();
  const start = requests.length;
  const result = await prep.prepareOffline({ userId: 'user', profile: { id: 'user', role: ROLE, branch_id: profile.branch_id },
    activeBranch: selectedBranch, force: true, signal: new AbortController().signal, yieldToPos: async () => undefined });
  assert.equal(result, 'completed');
  const prepared = tableReads(start);
  const entries = await prep.loadPrepareEntries('user');
  const notReady = entries.filter(e => e.status !== 'ready');
  assert.deepEqual(notReady.map(e => `${e.key}: ${e.status} ${e.error ?? ''}`), [], 'every planned entry is ready');
  assert.equal(prep.indicatorState({ running: false, done: 0, total: 0, storageWarning: false, entries }).kind, 'ready');

  let pageTotal = 0;
  for (const [route, reads] of pageReads) {
    const missing = [...reads].filter(k => !prepared.has(k));
    assert.deepEqual(missing, [], `${route}: every page read is a prepared read`);
    pageTotal += reads.size;
  }
  const savedKeys = new Set((await offlineDb.readCache.toArray()).map(e => `${e.scopeKey}|${e.queryKey}`));
  const scope = selectedBranch ?? 'owner-all';
  for (const [route, reads] of pageReads) {
    const unsaved = [...reads].filter(k => !savedKeys.has(`${scope}|${k}`)
      // Access reads and Activity snapshots are kept in meta, not the read cache.
      && !/ \/rest\/v1\/(profiles|staff_permissions|pharmacy_subscriptions|activity_log|staff_goals|staff_goal_assignments|staff_goal_completions)\?/.test(k)
      && !(k.includes('/rest/v1/pharmacy_branches?') && (route === '/activity' || route === '/owner/activity')));
    assert.deepEqual(unsaved, [], `${route}: every page read is saved under the viewed scope`);
  }

  // Paging completeness: the progressive list was read to the end (24 + next page), not just page 1.
  const expectedItems = ROLE === 'owner' ? items.length : items.filter(i => i.branch_id === 'b1').length;
  assert.equal(entries.find(e => e.key === `inventory.items@${selectedBranch ?? 'owner-all'}`)?.rows, expectedItems, 'inventory list is complete');

  // 3) Offline: pages never opened online are served from the prepared copies.
  online = false;
  setOfflineState({ reachable: false, connection: 'offline' });
  rc.markOffline();
  const before = networkCalls;
  for (const page of pages) {
    rc.resetReadStatus();
    const text = await renderPage(page);
    const status = rc.getReadStatus().byPath[page.route];
    assert.equal(status?.misses ?? 0, 0, `${page.route}: no read missing offline`);
    assert.ok(!text.includes(NOT_CACHED), `${page.route}: no "open it once" fallback`);
    assert.ok(!text.includes('not loaded before going offline'), `${page.route}: activity was prepared`);
    if (page.expect) assert.ok(text.includes(page.expect), `${page.route}: shows "${page.expect}"`);
  }
  // RPCs are never cached by design; the Overview's smart-inventory RPC attempt fails offline and the
  // widget falls back to its prepared branch_items read. No table read may reach the network.
  const attempted = requests.slice(requests.length - (networkCalls - before));
  const tableAttempts = attempted.filter(r => !r.url.includes('/rest/v1/rpc/'));
  assert.deepEqual(tableAttempts.map(r => `${r.method} ${r.url}`), [], 'offline pages made no table reads over the network');
  // Cap: with a 24-row cap (20,000 in production) the list stops after the cap and is reported as capped.
  online = true; setOfflineState({ reachable: true, connection: 'online' });
  const capStart = requests.length;
  await prep.prepareOffline({ userId: 'user', profile: { id: 'user', role: ROLE, branch_id: profile.branch_id }, activeBranch: selectedBranch,
    force: true, signal: new AbortController().signal, yieldToPos: async () => undefined, maxRows: 24,
    registry: prep.PREPARE_REGISTRY.filter(d => d.priority === 0 || d.id === 'inventory.items') });
  const cappedEntry = (await prep.loadPrepareEntries('user')).find(e => e.key === `inventory.items@${selectedBranch ?? 'owner-all'}`);
  assert.equal(cappedEntry?.status, 'capped'); assert.equal(cappedEntry?.rows, 24);
  const pagesRead = requests.slice(capStart).filter(r => r.url.includes('/branch_items?') && new URL(r.url).searchParams.get('limit'));
  assert.deepEqual([...new Set(pagesRead.map(r => new URL(r.url).searchParams.get('offset')))], ['0'], 'no page requested beyond the cap');
  console.log(`Offline preparation (${ROLE}) passed: ${entries.length} entries ready; ${pageTotal} page reads across ${pages.length} pages all prepared (${prepared.size} prepared reads); offline: 0 misses, 0 table reads over the network (${attempted.length} uncached RPC attempt(s) failed as offline)`);
} finally {
  await offlineDb.delete(); await dom.happyDOM.close();
}
// The real auth client keeps refresh timers alive; the checks above are complete.
process.exit(0);
