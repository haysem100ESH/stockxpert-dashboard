import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { offlineDb, readMeta } from '@/lib/offline/db';
import { callPos, checkReachability, validSession, withPosLock } from '@/lib/offline/network';
import { getOfflineState, setOfflineState } from '@/lib/offline/store';
import { retryDelay, SYNCED_RETENTION_MS } from '@/lib/offline/rules';
import { settleSale } from '@/lib/offline/queue';
import { saleEffects } from '@/lib/offline/effects';
import { fetchCatalog, replaceCatalog } from '@/lib/offline/catalog';
import type { RpcResult } from '@/lib/offline/types';
import { supabase } from '@/lib/db';

export function useOfflineSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user) { setOfflineState({ records: [], pendingCount: 0, needsAttentionCount: 0 }); return; }
    const userId = user.id;
    let disposed = false;
    let running = false;
    const subscription = liveQuery(async () => ({
      records: await offlineDb.sales.where('userId').equals(userId).sortBy('createdAt'),
      lastSuccessfulSync: await readMeta<string>(`lastSuccessfulSync:${userId}`),
    })).subscribe({ next: ({ records, lastSuccessfulSync }) => {
      if (disposed) return;
      const pendingCount = records.filter(r => r.status === 'pending' || r.status === 'syncing').length;
      const needsAttentionCount = records.filter(r => r.status === 'needs_attention').length;
      const current = getOfflineState();
      setOfflineState({ records, pendingCount, needsAttentionCount, lastSuccessfulSync,
        connection: current.connection === 'syncing' || current.connection === 'sign_in_required' ? current.connection
          : !current.reachable ? 'offline' : needsAttentionCount ? 'needs_attention' : 'online' });
    }, error: () => setOfflineState({ storageError: 'Local storage is unavailable. Offline sales cannot be saved.' }) });

    const sync = async (recover = false) => {
      if (running || disposed) return;
      running = true;
      try {
        await withPosLock(async () => {
          if (recover) await offlineDb.sales.where('userId').equals(userId).and(r => r.status === 'syncing')
            .modify({ status: 'pending', updatedAt: new Date().toISOString() });
          const cutoff = new Date(Date.now() - SYNCED_RETENTION_MS).toISOString();
          await offlineDb.sales.where('userId').equals(userId).and(r => r.status === 'synced' && !!r.syncedAt && r.syncedAt < cutoff).delete();
          if (!await checkReachability() || !await validSession(userId)) return;
          // Owner reconciliation does not automatically retry a cashier's conflict.
          // Read its authoritative outcome to release the reservation when resolved.
          const attention = await offlineDb.sales.where('userId').equals(userId).and(r => r.status === 'needs_attention' && !!r.issueId).toArray();
          for (const record of attention) {
            const { data, error } = await supabase.from('pos_sync_issues').select('*').eq('id', record.issueId).maybeSingle();
            if (error || !data) continue;
            if (data.status === 'voided' || data.status === 'synced' || data.status === 'resolved') {
              let resolution: RpcResult = { status: 'voided', issue_id: record.issueId, reason_code: data.reason_code };
              if (data.status !== 'voided') {
                // Do not assume an issue-table sale-ID column. The original ID
                // safely reads back an already reconciled sale through the RPC.
                const reply = await callPos(record.payload, record.mode);
                if (reply.error || reply.data?.status !== 'synced') continue;
                resolution = { ...reply.data, duplicate: true } as RpcResult;
              }
              await settleSale(record, resolution);
              try {
                const rows = await fetchCatalog([record.branchId], userId);
                await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog([record.branchId], userId, rows));
              } catch { /* Keep last snapshot until online refresh. */ }
              queryClient.invalidateQueries(); window.dispatchEvent(new Event('app:refresh'));
            }
          }
          const pending = await offlineDb.sales.where('userId').equals(userId).and(r => r.status === 'pending').sortBy('createdAt');
          for (const record of pending) {
            if (disposed || (record.nextAttemptAt ?? 0) > Date.now()) break;
            setOfflineState({ connection: 'syncing' });
            await offlineDb.sales.update(record.clientTxnId, { status: 'syncing', updatedAt: new Date().toISOString() });
            try {
              const { data, error } = await callPos(record.payload, record.mode);
              if (error || !data || !['synced', 'needs_attention', 'voided', 'rejected'].includes(data.status)) throw error ?? new Error('Unknown server outcome');
              const result = data as RpcResult;
              await settleSale(record, result);
              if (result.status === 'synced') {
                await saleEffects(record, result);
                try {
                  const rows = await fetchCatalog([record.branchId], userId);
                  await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog([record.branchId], userId, rows));
                } catch { /* Keep conservative snapshot. */ }
                queryClient.invalidateQueries();
                window.dispatchEvent(new Event('app:refresh'));
              }
            } catch (error) {
              const attempts = record.attempts + 1;
              await offlineDb.sales.update(record.clientTxnId, { status: 'pending', attempts,
                nextAttemptAt: Date.now() + retryDelay(attempts), updatedAt: new Date().toISOString(),
                lastError: error instanceof Error ? error.message : 'Could not confirm server outcome' });
              if (await checkReachability()) await validSession(userId);
              break;
            }
          }
        });
      } catch { setOfflineState({ storageError: 'Local storage is unavailable. Pending sales have not been removed.' }); }
      finally {
        running = false;
        const current = getOfflineState();
        if (current.connection !== 'sign_in_required') setOfflineState({ connection: !current.reachable ? 'offline' : current.needsAttentionCount ? 'needs_attention' : 'online' });
      }
    };
    const trigger = () => { void sync(); };
    const visible = () => { if (document.visibilityState === 'visible') trigger(); };
    const offline = () => setOfflineState({ reachable: false, connection: 'offline' });
    void sync(true);
    window.addEventListener('online', trigger);
    window.addEventListener('offline', offline);
    window.addEventListener('pos:queue', trigger);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(() => { if (getOfflineState().pendingCount || getOfflineState().needsAttentionCount || !getOfflineState().reachable) trigger(); }, 30_000);
    return () => { disposed = true; subscription.unsubscribe(); clearInterval(interval);
      window.removeEventListener('online', trigger); window.removeEventListener('offline', offline);
      window.removeEventListener('pos:queue', trigger); document.removeEventListener('visibilitychange', visible); };
  }, [user?.id, queryClient]);
}