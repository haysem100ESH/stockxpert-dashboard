import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from './useAuth';
import type { ActivityRow } from './useActivityFeed';
import { offlineDb } from '@/lib/offline/db';
import { pendingActivityRows, type ActivityRange } from '@/lib/offline/activity';
import type { LocalSale } from '@/lib/offline/types';

export function usePendingActivities(serverRows: ActivityRow[] = [], range: ActivityRange = {}) {
  const { user } = useAuth();
  const [local, setLocal] = useState<{ userId: string; records: LocalSale[]; known: ActivityRow[] }>();
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const sub = liveQuery(async () => {
      const records = await offlineDb.sales.where('userId').equals(userId).toArray();
      const feeds = await offlineDb.meta.filter(row => row.key.startsWith(`activity:${userId}:feed:`)).toArray();
      const known = feeds.flatMap(row => (row.value as { data?: ActivityRow[] }).data ?? []);
      return { userId, records, known };
    }).subscribe({ next: setLocal, error: () => setLocal(undefined) });
    return () => sub.unsubscribe();
  }, [user?.id]);
  if (!user || local?.userId !== user.id) return [];
  return pendingActivityRows(local.records, user.id, [...local.known, ...serverRows], range);
}