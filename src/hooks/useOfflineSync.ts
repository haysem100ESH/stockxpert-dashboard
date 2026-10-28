import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { offlineDb, readMeta } from '@/lib/offline/db';
import { callPos, checkReachability, validSession, withPosLock } from '@/lib/offline/network';
import { getOfflineState, setOfflineState } from '@/lib/offline/store';
import { retryMode, SYNCED_RETENTION_MS } from '@/lib/offline/rules';
import { syncSale } from '@/lib/offline/syncSale';
import { recoverUserQueue, settleSale } from '@/lib/offline/queue';
import { saleEffects } from '@/lib/offline/effects';
import { fetchCatalog, replaceCatalog } from '@/lib/offline/catalog';
import type { RpcResult } from '@/lib/offline/types';
import { supabase } from '@/lib/db';
import { syncOp, recoverUserOps, dependencyReady, settleOp } from '@/lib/offline/syncOp';
import type { OpResult } from '@/lib/offline/opTypes';

export function useOfflineSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user) { setOfflineState({ records: [], ops: [], pendingCount: 0, needsAttentionCount: 0 }); return; }
    const userId = user.id;
    let disposed = false;
    let running = false;
    const subscription = liveQuery(async () => ({
      records: await offlineDb.sales.where('userId').equals(userId).sortBy('createdAt'),
      ops: await offlineDb.ops.where('userId').equals(userId).sortBy('deviceCreatedAt'),
      lastSuccessfulSync: await readMeta<string>(`lastSuccessfulSync:${userId}`),
    })).subscribe({ next: ({ records, ops, lastSuccessfulSync }) => {
      if (disposed) return;
      const pendingCount = [...records, ...ops].filter(r => r.status === 'pending' || r.status === 'syncing').length;
      const needsAttentionCount = [...records, ...ops].filter(r => r.status === 'needs_attention').length;
      const current = getOfflineState();
      setOfflineState({ records, ops, pendingCount, needsAttentionCount, lastSuccessfulSync,
        connection: current.connection === 'syncing' || current.connection === 'sign_in_required' ? current.connection
          : !current.reachable ? 'offline' : needsAttentionCount ? 'needs_attention' : 'online' });
    }, error: () => setOfflineState({ storageError: 'Local storage is unavailable. Offline sales cannot be saved.' }) });

    const sync = async (recover = false) => {
      if (running || disposed) return;
      running = true;
      try {
        await withPosLock(async () => {
          if (disposed) return;
          if (recover) { await recoverUserQueue(userId); await recoverUserOps(userId); }
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
                const reply = await callPos(record.payload, retryMode(record.payload));
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
          const ownerOps = await offlineDb.ops.where('userId').equals(userId).and(o => o.status === 'needs_attention' && !!o.serverIssue).toArray();
          for (const op of ownerOps) {
            const { data, error } = await supabase.from('offline_ops').select('*').eq('op_id', op.opId).maybeSingle();
            if (!error && data && ['applied', 'voided'].includes(data.status)) {
              await settleOp(op, { ...data, updated_at: data.result?.updated_at ?? data.updated_at,
                resolution_note: data.resolution_note ?? data.result?.resolution_note } as OpResult);
              queryClient.invalidateQueries(); window.dispatchEvent(new Event('app:refresh'));
            }
          }
          const sales = await offlineDb.sales.where('userId').equals(userId).and(r => r.status === 'pending').toArray();
          const ops = await offlineDb.ops.where('userId').equals(userId).and(o => o.status === 'pending' || (o.status === 'needs_attention' && o.reasonCode === 'DEPENDS_ON_UNSYNCED')).toArray();
          const pending = [...sales.map(record => ({ kind: 'sale' as const, record, at: record.payload.device_created_at || record.createdAt })),
            ...ops.map(record => ({ kind: 'op' as const, record, at: record.deviceCreatedAt }))].sort((a, b) => a.at.localeCompare(b.at));
          for (const item of pending) {
            if (disposed) break;
            if ((item.record.nextAttemptAt ?? 0) > Date.now()) continue;
            if (item.kind === 'op') {
              const op = await offlineDb.ops.get(item.record.opId);
              if (!op || op.userId !== userId) continue;
              if (op.status === 'needs_attention' && !await dependencyReady(op)) continue;
              setOfflineState({ connection: 'syncing' });
              const result = await syncOp(op);
              if (result?.status === 'applied') { queryClient.invalidateQueries(); window.dispatchEvent(new Event('app:refresh')); }
              if (!result && (await offlineDb.ops.get(op.opId))?.status === 'pending' && !await dependencyReady(op)) continue;
              if (!result && (await offlineDb.ops.get(op.opId))?.status === 'pending') break;
              continue;
            }
            const record = item.record;
            setOfflineState({ connection: 'syncing' });
            const result = await syncSale(record);
            if (!result) {
              if (await checkReachability()) await validSession(userId);
              if ((await offlineDb.sales.get(record.clientTxnId))?.status === 'pending') break;
              continue;
            }
            if (result.status === 'synced') {
              await saleEffects(record, result);
              try {
                const rows = await fetchCatalog([record.branchId], userId);
                await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog([record.branchId], userId, rows));
              } catch { /* Keep conservative snapshot. */ }
              queryClient.invalidateQueries(); window.dispatchEvent(new Event('app:refresh'));
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