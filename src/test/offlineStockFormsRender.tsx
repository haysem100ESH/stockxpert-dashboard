import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { strict as assert } from 'node:assert';
import { mock } from 'bun:test';

const dom = new Window({ url: 'http://localhost:8080/inventory' });
for (const key of ['dispatchEvent', 'addEventListener', 'removeEventListener']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: Reflect.get(dom, key).bind(dom) });
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'MutationObserver', 'ResizeObserver', 'Event', 'MouseEvent', 'CustomEvent', 'HTMLInputElement', 'DocumentFragment', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? dom : Reflect.get(dom, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(dom) : value });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
const user = { id: 'cashier' };
let backendWrites = 0;
const queued: Array<{ opType: string; values: Record<string, unknown> }> = [];
const batch = { id: 'batch', branch_item_id: 'item', batch_number: 'BN-1', quantity: 12, remaining_quantity: 12, purchase_price: 2, selling_price: 4 };
mock.module('@/hooks/useAuth', () => ({ useAuth: () => ({ user, profile: { id: user.id, role: 'staff', branch_id: 'branch' } }) }));
mock.module('@/hooks/useBranchContext', () => ({ useBranchContext: () => ({ selectedBranch: 'branch' }) }));
mock.module('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }), toast: () => {} }));
mock.module('@/lib/db', () => ({ supabase: {
  auth: { getUser: async () => { backendWrites++; throw new Error('Online save must be blocked'); } },
  from: () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'eq']) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    for (const method of ['insert', 'update', 'delete']) query[method] = () => { backendWrites++; throw new Error('Offline server write'); };
    return query;
  },
} }));
mock.module('@/lib/batchInventory', () => ({ getBatchesForItem: async () => [batch], createBatch: async () => { backendWrites++; }, deductFIFO: async () => { backendWrites++; }, syncBranchItemQuantity: async () => { backendWrites++; } }));
mock.module('@/lib/activityLog', () => ({ logActivity: () => { backendWrites++; }, logFieldChanges: () => { backendWrites++; } }));
mock.module('@/lib/offline/network', () => ({ checkReachability: async () => false }));
mock.module('@/hooks/useOfflineStock', () => ({ useOfflineStockPermission: () => ({ allowed: true }), stockQueued: () => {} }));
mock.module('@/lib/offline/stock', () => ({ stockContext: async () => ({ item: { id: 'item' }, batchKnown: true, batches: [], sales: [] }), cachedStockRows: async () => [], batchAvailableOnDevice: () => 12 }));
mock.module('@/lib/offline/ops', () => ({ userOps: async () => [], overlayRecords: (rows: unknown[]) => rows, enqueueOp: async (op: typeof queued[number]) => { queued.push(op); } }));
mock.module('@/lib/offline/readCache', () => ({ useReadCacheStatus: () => ({ byPath: {} }) }));

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: Guard } = await import('@/components/offline/OfflineReadGuard');
const { default: BatchesEditor } = await import('@/components/inventory/BatchesEditor');
const { default: StockAdjustmentDialog } = await import('@/components/inventory/StockAdjustmentDialog');
const { setOfflineState } = await import('@/lib/offline/store');
setOfflineState({ reachable: false, connection: 'offline', records: [], ops: [] });
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
const render = async (child: React.ReactNode) => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/inventory']}><QueryClientProvider client={qc}><Guard><main>{child}</main></Guard></QueryClientProvider></MemoryRouter>));
  await flush();
};
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === label);
  assert.ok(found, `Missing button: ${label}`); return found;
};
const input = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setter);
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
let saved = 0;
try {
  await render(<BatchesEditor branchId="branch" medicineId="medicine" branchItemId="item" defaultPurchasePrice={2} defaultSellingPrice={4} />);
  const quantity = document.querySelector<HTMLInputElement>('tbody tr td:nth-child(2) input');
  assert.ok(quantity); assert.equal(quantity.value, '12');
  await input(quantity, '99');
  const absoluteSave = button('Save Batch Changes');
  assert.equal(absoluteSave.getAttribute('data-offline-disabled'), 'true');
  assert.equal(absoluteSave.getAttribute('aria-disabled'), 'true');
  await act(async () => absoluteSave.click()); await flush();
  assert.equal(backendWrites, 0); assert.equal(queued.length, 0);

  await render(<StockAdjustmentDialog open medicine={{ id: 'item', name: 'Medicine', branch_id: 'branch', stock_quantity: 12, purchase_price: 2 }} onOpenChange={() => {}} onAdjusted={() => { saved++; }} />);
  const delta = document.getElementById('stock-delta');
  assert.ok(delta instanceof HTMLInputElement);
  await input(delta, '-2');
  const save = button('Save on this device');
  assert.equal(save.disabled, false); assert.equal(save.hasAttribute('data-offline-disabled'), false);
  assert.equal(document.querySelector('tbody'), null);
  assert.equal([...document.querySelectorAll('button')].some(el => el.textContent?.trim() === 'Add New Batch'), false);
  await act(async () => save.click()); await flush();
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.opType, 'stock.adjust');
  assert.deepEqual(queued[0]?.values, { branch_item_id: 'item', delta: -2, reason_type: 'damage', note: '' });
  assert.equal(saved, 1); assert.equal(backendWrites, 0);
  console.log('Offline stock form regression passed');
} finally {
  await act(async () => root.unmount()); qc.clear(); await dom.happyDOM.close();
}