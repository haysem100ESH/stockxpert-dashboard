import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from './useAuth';
import { offlineDb } from '@/lib/offline/db';
import { refreshStorageProtection } from '@/lib/offline/storageGuard';
import { backupSupported, createBackupScheduler, runBackup } from '@/lib/offline/backup';
import { setOfflineState } from '@/lib/offline/store';

/** Requests persistent storage and keeps the automatic backup file current. Never blocks POS work. */
export function useOfflineBackup() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    void refreshStorageProtection().catch(() => {});
    if (!backupSupported()) { setOfflineState({ backup: { state: 'unsupported' } }); return; }
    const userId = user.id;
    const scheduler = createBackupScheduler(() => runBackup(userId));
    void scheduler.flush();
    let first = true;
    const sub = liveQuery(async () => [
      ...(await offlineDb.sales.where('userId').equals(userId).toArray()).map(r => `${r.clientTxnId}:${r.status}:${r.updatedAt}`),
      ...(await offlineDb.ops.where('userId').equals(userId).toArray()).map(o => `${o.opId}:${o.status}:${o.updatedAt}`),
    ].join('|'))
      .subscribe({ next: () => { if (first) { first = false; return; } scheduler.schedule(); }, error: () => {} });
    const now = () => { void scheduler.flush(); };
    window.addEventListener('pos:backup-now', now);
    return () => { sub.unsubscribe(); scheduler.cancel(); window.removeEventListener('pos:backup-now', now); };
  }, [user?.id]);
}
