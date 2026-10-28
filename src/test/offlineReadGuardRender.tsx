import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { strict as assert } from 'node:assert';
import { mock } from 'bun:test';

const dom = new Window({ url: 'http://localhost:8080/inventory' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'NodeFilter',
  'MutationObserver', 'Event', 'MouseEvent', 'CustomEvent', 'HTMLInputElement', 'DocumentFragment',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? dom : Reflect.get(dom, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(dom) : value });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls = { backup: 0, filePicker: 0, parse: 0, restore: 0, remove: 0, write: 0, submit: 0 };
const user = { id: 'cashier' };
const toast = () => {};
mock.module('@/hooks/useAuth', () => ({ useAuth: () => ({ user,
  removeMyDeviceData: async () => { calls.remove++; } }) }));
mock.module('@/hooks/use-toast', () => ({ toast, useToast: () => ({ toast }) }));
mock.module('@/lib/offline/readCache', () => ({ useReadCacheStatus: () => ({
  byPath: { '/inventory': { oldest: '2026-10-28T10:00:00Z', misses: 0 } },
}) }));
mock.module('@/lib/offline/deviceSafety', () => ({ userSales: async () => [],
  isUnresolved: () => false, exportFingerprint: () => 'empty', exportPendingSales: async () => 'empty',
  retryUserSales: async () => {}, discardUserSale: async () => {},
}));
mock.module('@/lib/offline/backup', () => ({ backupSupported: () => true,
  setUpBackup: async () => { calls.backup++; }, resumeBackup: async () => {},
}));
const backup = { sales: [] };
mock.module('@/lib/offline/restore', () => ({
  parseBackup: () => { calls.parse++; return backup; },
  previewBackup: () => ({ count: 0, total: 0, statuses: {} }),
  restoreBackup: async () => { calls.restore++; return { restored: 0, present: 0, skippedSynced: 0, invalid: 0 }; },
}));

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { default: OfflineReadGuard } = await import('@/components/offline/OfflineReadGuard');
const { default: OfflineStatusBadge } = await import('@/components/sales/OfflineStatusBadge');
const { Dialog, DialogContent, DialogTitle, DialogDescription } = await import('@/components/ui/dialog');
const { Button } = await import('@/components/ui/button');
const { setOfflineState } = await import('@/lib/offline/store');
const { offlineDb } = await import('@/lib/offline/db');
setOfflineState({ reachable: false, connection: 'offline', records: [] });

const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); };
const find = (text: string, selector = 'button') => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find(node => node.textContent?.trim() === text);
  assert.ok(el, `Missing control: ${text}`);
  return el;
};
const clickLocal = async (el: HTMLElement) => {
  assert.equal(el.hasAttribute('data-offline-disabled'), false, 'Local action must not be marked offline-disabled');
  await act(async () => { el.click(); });
  await flush();
};

try {
  await act(async () => { root.render(<MemoryRouter initialEntries={['/inventory']}>
    <OfflineReadGuard><main><OfflineStatusBadge /></main>
      <Dialog open><DialogContent><DialogTitle>Add customer</DialogTitle><DialogDescription>Customer details</DialogDescription>
        <form onSubmit={event => { event.preventDefault(); calls.submit++; }}>
          <Button type="submit" onClick={() => { calls.write++; }}>Add customer</Button>
        </form>
      </DialogContent></Dialog>
    </OfflineReadGuard>
  </MemoryRouter>); });
  await flush();
  const pageWrite = find('Add customer');
  assert.equal(pageWrite.getAttribute('data-offline-disabled'), 'true');
  await act(async () => { pageWrite.click(); });
  const form = pageWrite.closest('form');
  assert.ok(form);
  await act(async () => { form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(calls.write, 0);
  assert.equal(calls.submit, 0);

  const opener = document.querySelector<HTMLElement>('[aria-label="Open device sales"]');
  assert.ok(opener);
  await clickLocal(opener);
  await clickLocal(find('Set up automatic backup'));
  assert.equal(calls.backup, 1);

  const restoreLabel = find('Restore from backup file', 'label');
  const input = restoreLabel.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input);
  input.addEventListener('click', event => { calls.filePicker++; event.preventDefault(); });
  await clickLocal(restoreLabel);
  assert.equal(calls.filePicker, 1);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'backup.json', text: async () => '{}' }] });
  await act(async () => { input.dispatchEvent(new dom.Event('change', { bubbles: true })); });
  await flush();
  assert.equal(calls.parse, 1);
  await clickLocal(find('Confirm restore'));
  assert.equal(calls.restore, 1);

  await clickLocal(find('Remove my data from this PC'));
  const confirm = find('Confirm removal');
  assert.equal(confirm.hasAttribute('disabled'), false);
  await clickLocal(confirm);
  assert.equal(calls.remove, 1);
  assert.equal(pageWrite.getAttribute('data-offline-disabled'), 'true');
  console.log('Offline panel regression passed');
} finally {
  await act(async () => { root.unmount(); });
  await offlineDb.delete();
  await dom.happyDOM.close();
}