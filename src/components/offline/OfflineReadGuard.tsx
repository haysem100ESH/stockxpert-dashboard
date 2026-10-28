import { ReactNode, SyntheticEvent, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOfflineStatus } from '@/lib/offline/store';
import { useReadCacheStatus } from '@/lib/offline/readCache';
import { isWriteControl, NEEDS_INTERNET, NOT_CACHED } from '@/lib/offline/offlinePages';
import { RESERVING_STATUSES } from '@/lib/offline/rules';
import { toast } from '@/hooks/use-toast';

const CONTROL_SELECTOR = 'button, [role="menuitem"], [role="switch"], input[type="submit"]';
const describe = (el: Element) => ({
  text: el.getAttribute('aria-label') || el.getAttribute('data-offline-title') || el.getAttribute('title') || el.textContent || '',
  role: el.getAttribute('role'), type: el.getAttribute('type'),
  icons: [...el.querySelectorAll('svg')].map(svg => svg.getAttribute('class') ?? '').join(' '),
});
const allowed = (el: Element) => !!el.closest('[data-offline-allow], header, [data-sidebar]');
const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;

let lastToast = 0;
function needsInternetToast(inDialog: boolean) {
  if (Date.now() - lastToast < 1500) return;
  lastToast = Date.now();
  toast({ title: NEEDS_INTERNET, variant: 'destructive',
    description: inDialog ? 'The connection dropped. Nothing was sent — reconnect, then save again.' : 'This action needs an internet connection. Viewing still works offline.' });
}

/** Offline read-only shell for in-scope pages: banner + every write control disabled. Inactive online. */
export default function OfflineReadGuard({ children }: { children: ReactNode }) {
  const { reachable, records } = useOfflineStatus();
  const { pathname } = useLocation();
  const status = useReadCacheStatus();

  useEffect(() => {
    if (reachable) return;
    const mark = () => {
      const roots = [...document.querySelectorAll('main, [role="dialog"], [role="alertdialog"], [role="menu"]')];
      for (const root of roots) for (const el of root.querySelectorAll(CONTROL_SELECTOR)) {
        if (allowed(el) && el.hasAttribute('data-offline-disabled')) {
          const title = el.getAttribute('data-offline-title');
          if (title) el.setAttribute('title', title); else el.removeAttribute('title');
          el.removeAttribute('data-offline-disabled'); el.removeAttribute('data-offline-title'); el.removeAttribute('aria-disabled');
        }
        if (el.hasAttribute('data-offline-disabled') || allowed(el) || !isWriteControl(describe(el))) continue;
        el.setAttribute('data-offline-disabled', 'true');
        el.setAttribute('data-offline-title', el.getAttribute('title') ?? '');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('title', NEEDS_INTERNET);
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-offline-allow'] });
    return () => {
      observer.disconnect();
      for (const el of document.querySelectorAll('[data-offline-disabled]')) {
        const title = el.getAttribute('data-offline-title');
        if (title) el.setAttribute('title', title); else el.removeAttribute('title');
        el.removeAttribute('data-offline-disabled'); el.removeAttribute('data-offline-title'); el.removeAttribute('aria-disabled');
      }
    };
  }, [reachable]);

  const block = (e: SyntheticEvent) => {
    if (reachable) return;
    const target = e.target as HTMLElement;
    if (e.type === 'submit') {
      if (allowed(target)) return;
      e.preventDefault(); e.stopPropagation(); needsInternetToast(!!target.closest('[role="dialog"], [role="alertdialog"]')); return;
    }
    const el = target.closest(CONTROL_SELECTOR);
    if (!el || allowed(el) || !(el.hasAttribute('data-offline-disabled') || isWriteControl(describe(el)))) return;
    e.preventDefault(); e.stopPropagation();
    needsInternetToast(!!el.closest('[role="dialog"], [role="alertdialog"]'));
  };

  const page = status.byPath[pathname];
  const savedAt = time(page?.oldest ?? status.offlineSince);
  const pending = records.filter(r => RESERVING_STATUSES.some(s => s === r.status));
  const pendingTotal = pending.reduce((sum, r) => sum + (r.summary?.total ?? r.payload.total_amount ?? 0), 0);

  return (
    <>
      {!reachable && (
        <div className="space-y-2 mb-3">
          <Alert className="border-warning/50 bg-warning/10">
            <WifiOff className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {savedAt ? `Offline — showing data saved at ${savedAt}.` : 'Offline — showing data saved on this PC.'}
              {pathname === '/customers' && savedAt ? ` Balances as of ${savedAt}.` : ''}
              {' '}{['/customers', '/suppliers', '/medicine-codes'].includes(pathname) ? 'Record changes are saved on this PC until synced.' : 'Changes need internet.'}
            </AlertDescription>
          </Alert>
          {!!page?.misses && <Alert variant="destructive"><AlertDescription className="text-sm">{NOT_CACHED}</AlertDescription></Alert>}
          {pathname === '/' && pending.length > 0 && (
            <Alert><AlertDescription className="text-sm">
              {pending.length} sale{pending.length === 1 ? '' : 's'} on this PC ({pendingTotal.toFixed(2)}) not yet confirmed — not included in the totals below.
            </AlertDescription></Alert>
          )}
        </div>
      )}
      <div onClickCapture={block} onSubmitCapture={block}>{children}</div>
    </>
  );
}
