import { useCallback, useEffect, useRef, useState } from 'react';
import { useOfflineStatus } from '@/lib/offline/store';
import { checkReachability } from '@/lib/offline/network';
import { readActivityCache, saveActivityCache, offlineActivityMessage } from '@/lib/offline/activity';

/** A snapshot of exactly the query this user loaded; never synthesizes missing coverage. */
export function useActivitySnapshot<T>(userId: string | undefined, scope: string, initial: T, loader: () => Promise<T>) {
  const { reachable } = useOfflineStatus();
  const [state, setState] = useState<{ identity: string; data: T; savedAt?: string; offline: boolean; loading: boolean }>();
  const identity = `${userId}:${scope}`;
  const current = useRef(identity); current.current = identity;
  const initialRef = useRef(initial); initialRef.current = initial;
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!userId) return;
    const request = ++generation.current;
    const active = () => current.current === identity && request === generation.current;
    setState(old => ({ identity, data: old?.identity === identity ? old.data : initialRef.current,
      savedAt: old?.identity === identity ? old.savedAt : undefined, offline: !reachable, loading: true }));
    const fallback = async () => {
      const cached = await readActivityCache<T>(userId, scope).catch(() => undefined);
      if (active()) setState({ identity, data: cached?.data ?? initialRef.current, savedAt: cached?.savedAt, offline: true, loading: false });
    };
    if (!reachable || !await checkReachability()) { await fallback(); return; }
    try {
      const data = await loader();
      if (!active()) return;
      const savedAt = new Date().toISOString();
      setState({ identity, data, savedAt, offline: false, loading: false });
      await saveActivityCache(userId, scope, data, savedAt).catch(() => undefined);
    } catch { await fallback(); }
  }, [userId, scope, identity, reachable, loader]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (reachable) void load(); };
    window.addEventListener('app:refresh', refresh);
    return () => window.removeEventListener('app:refresh', refresh);
  }, [load, reachable]);
  const setData = useCallback((update: (data: T) => T) => {
    setState(old => {
      if (!userId || old?.identity !== identity || old.offline || !reachable) return old;
      const data = update(old.data);
      const savedAt = new Date().toISOString();
      void saveActivityCache(userId, scope, data, savedAt).catch(() => undefined);
      return { ...old, data, savedAt };
    });
  }, [userId, scope, identity, reachable]);
  const matching = state?.identity === identity ? state : undefined;
  const offline = !reachable || matching?.offline === true;
  return { data: matching?.data ?? initial, loading: matching?.loading ?? !!userId, setData, refetch: load,
    offline, cachedAt: matching?.savedAt, cacheMissing: offline && !matching?.savedAt,
    banner: offlineActivityMessage(!offline, matching?.savedAt) };
}