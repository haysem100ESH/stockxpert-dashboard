/**
 * usePullToRefresh
 * ----------------------------------------------------------------------------
 * Native-feeling pull-to-refresh for the mobile responsive web app.
 *
 * - Uses the well-tested `pulltorefreshjs` library for the smooth iOS/Android-
 *   style spinner + drag animation.
 * - On release, invalidates the entire React Query cache (so cached lookups
 *   like owner branch IDs, dashboard stats, etc. re-fetch) and dispatches a
 *   `app:refresh` window event so legacy components that still use `useEffect`
 *   based fetching can re-fetch as well.
 * - Only mounts on touch devices to avoid hijacking desktop scroll.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function usePullToRefresh(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    // Touch-only: avoid interfering with desktop UX.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    let ptrInstance: any = null;
    let cancelled = false;

    (async () => {
      try {
        const PullToRefresh = (await import('pulltorefreshjs')).default;
        if (cancelled) return;

        ptrInstance = PullToRefresh.init({
          mainElement: 'body',
          distThreshold: 70,
          distMax: 120,
          distReload: 60,
          instructionsPullToRefresh: 'Pull down to refresh',
          instructionsReleaseToRefresh: 'Release to refresh',
          instructionsRefreshing: 'Refreshing…',
          shouldPullToRefresh: () => window.scrollY === 0,
          onRefresh: async () => {
            // Invalidate every query so cached data is re-fetched.
            await queryClient.invalidateQueries();
            // Notify any non-React-Query consumers.
            window.dispatchEvent(new CustomEvent('app:refresh'));
            // Small delay to make the spinner feel intentional.
            await new Promise((r) => setTimeout(r, 300));
          },
        });
      } catch (e) {
        console.warn('[pull-to-refresh] init failed', e);
      }
    })();

    return () => {
      cancelled = true;
      if (ptrInstance && typeof ptrInstance.destroy === 'function') {
        ptrInstance.destroy();
      }
    };
  }, [enabled, queryClient]);
}
