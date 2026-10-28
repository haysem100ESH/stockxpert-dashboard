import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { strict as assert } from 'node:assert';
import { mock } from 'bun:test';
const dom = new Window({ url: 'http://localhost:8080/customers' });
for (const key of ['dispatchEvent', 'addEventListener', 'removeEventListener']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: Reflect.get(dom, key).bind(dom) });
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'MutationObserver', 'ResizeObserver', 'Event', 'MouseEvent', 'CustomEvent', 'HTMLInputElement', 'DocumentFragment', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? dom : Reflect.get(dom, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(dom) : value });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
const user = { id: 'user' }; let edit = true; const notifications: unknown[] = []; let backendWrites = 0;
mock.module('@/hooks/useAuth', () => ({ useAuth: () => ({ user, profile: { id: 'user', role: 'staff', branch_id: 'branch' } }) }));
mock.module('@/hooks/useBranchContext', () => ({ useBranchContext: () => ({ selectedBranch: 'branch' }) }));
mock.module('@/hooks/useStaffPermissions', () => ({ useStaffPermissions: () => ({ getPermission: () => edit ? 'edit' : 'read', loading: false, uncachedOffline: false }) }));
mock.module('@/hooks/use-toast', () => ({ useToast: () => ({ toast: (value: unknown) => notifications.push(value) }), toast: () => {} }));
mock.module('@/lib/db', () => ({ supabase: { from: () => { backendWrites++; throw new Error('Offline forms must not write to server'); } } }));
mock.module('@/integrations/supabase/client', () => ({ supabase: {} }));
mock.module('@/hooks/useBranchInventory', () => ({ useBranchInventory: () => ({ items: [] }) }));
mock.module('@/hooks/useMedicineCodeAnalytics', () => ({ useMedicineCodeBatches: () => ({ batchesByMedicine: new Map(), globalAlertDays: 30 }), classifyExpiry: () => 'normal' }));
mock.module('@/components/inventory/MedicineCodeAnalytics', () => ({ default: () => null }));
mock.module('@/components/inventory/MedicineCodeBatchesDialog', () => ({ default: () => null }));
mock.module('@/lib/offline/network', () => ({ checkReachability: async () => false, withPosLock: (work: () => Promise<unknown>) => new Promise((resolve, reject) => setTimeout(() => { work().then(resolve, reject); }, 0)) }));
const React = await import('react'); const { act } = React;
const { createRoot } = await import('react-dom/client'); const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { offlineDb } = await import('@/lib/offline/db'); const { setOfflineState } = await import('@/lib/offline/store');
const { default: Guard } = await import('@/components/offline/OfflineReadGuard');
const { default: AddCustomer } = await import('@/components/customers/AddCustomerDialog');
const { default: EditCustomer } = await import('@/components/customers/EditCustomerDialog');
const { default: AddSupplier } = await import('@/components/suppliers/AddSupplierDialog');
const { default: EditSupplier } = await import('@/components/suppliers/EditSupplierDialog');
const { default: MedicineCodes } = await import('@/components/inventory/MedicineCodes');
await offlineDb.open(); await offlineDb.meta.bulkPut([
  { key: 'profile:user', value: { id: 'user', role: 'staff', active: true } }, { key: 'branches:user', value: ['branch'] },
  { key: 'subscription:user', value: { status: 'active' } }, { key: 'permissions:user', value: { customers: 'edit', suppliers: 'edit', inventory: 'edit' } },
]);
setOfflineState({ reachable: false, connection: 'offline', ops: [], records: [] });
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 70)); });
const render = async (child: React.ReactNode) => { await act(async () => root.render(<MemoryRouter><QueryClientProvider client={qc}><Guard><main>{child}</main></Guard></QueryClientProvider></MemoryRouter>)); await flush(); };
const input = async (id: string, value: string) => { const el = document.getElementById(id); assert.ok(el); await act(async () => { const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? dom.HTMLInputElement.prototype : dom.HTMLTextAreaElement.prototype, 'value')?.set; assert.ok(setter); setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const submit = async () => { const el = document.querySelector<HTMLButtonElement>('button[type="submit"]'); assert.ok(el); assert.equal(el.disabled, false); assert.equal(el.hasAttribute('data-offline-disabled'), false); const form = el.closest('form'); assert.ok(form); await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush(); };
try {
  await render(<AddCustomer open onOpenChange={() => {}} onCustomerAdded={() => {}} />);
  await input('name', 'Customer'); await input('phone', '123'); await input('notes', 'Notes');
  const radios = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]; assert.equal(radios.length, 3); assert.ok(radios.every(r => r.disabled));
  await submit(); let ops = await offlineDb.ops.toArray(); assert.equal(ops.length, 1); assert.deepEqual(ops[0]?.payload, { name: 'Customer', phone: '123', notes: 'Notes' });
  const customerId = ops[0]?.entityId; assert.ok(customerId);
  await render(<EditCustomer open customer={{ id: customerId, name: 'Customer', phone: '123', notes: 'Notes', max_credit_limit_raw: 999 }} onOpenChange={() => {}} onCustomerUpdated={() => {}} />);
  await input('edit-notes', 'Changed'); await submit(); ops = await offlineDb.ops.toArray(); assert.equal(ops.length, 2); assert.deepEqual(ops.find(o => o.opType === 'customer.update')?.payload, { notes: 'Changed' });
  await render(<AddSupplier open onOpenChange={() => {}} onSupplierAdded={() => {}} />); await input('name', 'Supplier'); await input('email', 'supplier@example.test'); await submit();
  ops = await offlineDb.ops.toArray(); const supplier = ops.find(o => o.opType === 'supplier.create'); assert.ok(supplier); assert.equal(supplier.payload.email, 'supplier@example.test');
  await render(<EditSupplier open supplier={{ id: supplier.entityId, name: 'Supplier', email: 'supplier@example.test' }} onOpenChange={() => {}} onSupplierUpdated={() => {}} />); await input('phone', '987'); await submit();
  ops = await offlineDb.ops.toArray(); assert.deepEqual(ops.find(o => o.opType === 'supplier.update')?.payload, { phone: '987' });
  await render(<MedicineCodes />);
  const button = (title: string) => { const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === title || b.title === title); assert.ok(found); return found; };
  await act(async () => button('New Code').click()); await flush();
  await input('code_code', 'MED-1'); await input('code_label', 'Medicine'); await input('code_notes', 'Notes');
  await act(async () => button('Save').click()); await flush();
  ops = await offlineDb.ops.toArray(); const code = ops.find(o => o.opType === 'medicine_code.create'); assert.ok(code); assert.deepEqual(code.payload, { code: 'MED-1', label: 'Medicine', notes: 'Notes' });
  await act(async () => button('Edit').click()); await flush();
  const codeInput = document.getElementById('code_code') as HTMLInputElement; assert.ok(codeInput); assert.equal(codeInput.disabled, true);
  await input('code_label', 'Changed label'); await act(async () => button('Save').click()); await flush();
  ops = await offlineDb.ops.toArray(); assert.deepEqual(ops.find(o => o.opType === 'medicine_code.update')?.payload, { label: 'Changed label' });
  edit = false; await render(<AddCustomer open onOpenChange={() => {}} onCustomerAdded={() => {}} />);
  const disabled = document.querySelector<HTMLButtonElement>('button[type="submit"]'); assert.ok(disabled); assert.equal(disabled.disabled, true);
  assert.equal(backendWrites, 0); assert.ok(notifications.length >= 6); console.log('Offline record form rules passed');
} finally { await act(async () => root.unmount()); qc.clear(); await offlineDb.delete(); await dom.happyDOM.close(); }