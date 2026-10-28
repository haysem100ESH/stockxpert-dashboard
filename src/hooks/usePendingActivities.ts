import type { LocalOp } from '@/lib/offline/opTypes';
import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from './useAuth';
import type { ActivityRow } from './useActivityFeed';
import { offlineDb } from '@/lib/offline/db';
import { pendingActivityRows, pendingOpActivityRows, type ActivityRange } from '@/lib/offline/activity';
import type { LocalSale } from '@/lib/offline/types';

export function usePendingActivities(serverRows: ActivityRow[] = [], range: ActivityRange = {}) {
  const { user } = useAuth();
  const [local, setLocal] = useState<{ userId: string; records: LocalSale[]; ops: LocalOp[]; known: ActivityRow[] }>();
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const sub = liveQuery(async () => {
      const records = await offlineDb.sales.where('userId').equals(userId).toArray();
      const feeds = await offlineDb.meta.filter(row => row.key.startsWith(`activity:${userId}:feed:`)).toArray();
      const known = feeds.flatMap(row => (row.value as { data?: ActivityRow[] }).data ?? []);
      return { userId, records, known, ops: await offlineDb.ops.where('userId').equals(userId).toArray() };
    }).subscribe({ next: setLocal, error: () => setLocal(undefined) });
    return () => sub.unsubscribe();
  }, [user?.id]);
  if (!user || local?.userId !== user.id) return [];
  return [...pendingActivityRows(local.records, user.id, [...local.known, ...serverRows], range), ...pendingOpActivityRows(local.ops, user.id, [...local.known, ...serverRows], range)].sort((a, b) => b.created_at.localeCompare(a.created_at));
}