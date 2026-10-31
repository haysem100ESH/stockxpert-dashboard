import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useOfflineStatus } from '@/lib/offline/store';
import { PREPARE_EVENT, prepareOffline, refreshPrepareEntries, setPrepareState } from '@/lib/offline/prepare';

const IDLE_FALLBACK_MS = 3000;
/** Freshness check cadence; only entries older than six hours (or marked changed) are fetched. */
const RECHECK_MS = 15 * 60 * 1000;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Background offline preparation scheduler. Mount once inside the signed-in layout.
 * Starts after first paint (idle callback, 3 s fallback), one request at a time; stops when
 * unreachable or signed out and re-prepares on reconnect. Never blocks or slows the page.
 */
export function useOfflinePrepare() {
  const { user, profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { reachable } = useOfflineStatus();
  const activeBranch = useRef(selectedBranch); activeBranch.current = selectedBranch;
  const reachableRef = useRef(reachable);
  const control = useRef<{ schedule: (force: boolean, immediate?: boolean) => void; abort: () => void } | null>(null);

  useEffect(() => {
    if (!user || !profile || profile.role === 'developer') { setPrepareState({ running: false, done: 0, total: 0, entries: [], userId: undefined }); return; }
    const userId = user.id;
    const prepProfile = { id: profile.id, role: profile.role, branch_id: profile.branch_id ?? null };
    const w = window as IdleWindow;
    let disposed = false;
    let controller: AbortController | null = null;
    let idle: number | null = null; let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false; let rerun: boolean | null = null;

    const clearPending = () => {
      if (idle !== null) w.cancelIdleCallback?.(idle);
      if (timer !== null) clearTimeout(timer);
      idle = null; timer = null;
    };
    const go = async (force: boolean) => {
      clearPending();
      if (disposed || !reachableRef.current) return;
      if (running) { rerun = rerun || force; return; }
      running = true; controller = new AbortController();
      try {
        await prepareOffline({ userId, profile: prepProfile, activeBranch: activeBranch.current, force, signal: controller.signal });
      } catch { /* preparation is best effort; statuses record failures */ }
      finally {
        running = false; controller = null;
        if (rerun !== null && !disposed) { const f = rerun; rerun = null; schedule(f); }
      }
    };
    const schedule = (force: boolean, immediate = false) => {
      if (disposed) return;
      if (running) { rerun = rerun || force; return; }
      clearPending();
      if (immediate) { timer = setTimeout(() => { void go(force); }, 0); return; }
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => { void go(force); }, { timeout: 30_000 });
      else timer = setTimeout(() => { void go(force); }, IDLE_FALLBACK_MS);
    };
    control.current = { schedule, abort: () => { clearPending(); controller?.abort(); } };

    void refreshPrepareEntries(userId);
    // First run after sign-in/app start: wait for first paint, then idle.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => schedule(false)) : null;
    if (raf === null) schedule(false);
    const onRequest = (e: Event) => schedule(!!(e as CustomEvent<{ force?: boolean }>).detail?.force, !!(e as CustomEvent<{ force?: boolean }>).detail?.force);
    window.addEventListener(PREPARE_EVENT, onRequest);
    const interval = setInterval(() => schedule(false), RECHECK_MS);
    return () => {
      disposed = true; control.current = null;
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearPending(); clearInterval(interval);
      window.removeEventListener(PREPARE_EVENT, onRequest);
      controller?.abort();
      setPrepareState({ running: false });
    };
  }, [user?.id, profile?.id, profile?.role, profile?.branch_id]);

  // Offline: stop immediately. Reconnect: re-prepare everything (forced), still idle-scheduled.
  useEffect(() => {
    const was = reachableRef.current;
    reachableRef.current = reachable;
    if (!reachable) control.current?.abort();
    else if (!was) control.current?.schedule(true);
  }, [reachable]);
}
