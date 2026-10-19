import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useActivitySnapshot } from './useActivitySnapshot';

export interface ActivityRow {
  client_txn_id?: string | null;
  pendingBadge?: string;
  id: string;
  user_id: string;
  owner_id: string;
  branch_id: string | null;
  activity_type: string;
  entity_type: string | null;
  entity_id: string | null;
  previous_value: any;
  new_value: any;
  metadata: any;
  created_at: string;
}

interface Options {
  userId?: string;          // restrict to a single staff
  branchId?: string;        // restrict to a branch
  date?: Date;              // single-day view
  from?: Date;
  to?: Date;
  limit?: number;
  ownerScope?: boolean;     // owner sees all under their owner_id
}

export function useActivityFeed(options: Options = {}) {
  const { profile, user } = useAuth();

  const computeRange = useCallback(() => {
    if (options.from && options.to) return { from: options.from, to: options.to };
    if (options.date) {
      const start = new Date(options.date); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(end.getDate()+1);
      return { from: start, to: end };
    }
    return null;
  }, [options.from, options.to, options.date]);

  const load = useCallback(async (): Promise<ActivityRow[]> => {
    if (!user) return [];
    let q = (supabase as any).from('activity_log').select('*').order('created_at', { ascending: false }).limit(options.limit ?? 200);

    if (options.userId) q = q.eq('user_id', options.userId);
    else if (!options.ownerScope) q = q.eq('user_id', user.id);

    if (options.branchId) q = q.eq('branch_id', options.branchId);

    const range = computeRange();
    if (range) {
      q = q.gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString());
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as ActivityRow[];
  }, [user, options.userId, options.branchId, options.ownerScope, options.limit, computeRange]);

  const range = computeRange();
  const scope = `feed:${JSON.stringify([options.userId ?? (options.ownerScope ? 'owner' : user?.id), options.branchId, options.ownerScope, options.limit ?? 200, range?.from.toISOString(), range?.to.toISOString()])}`;
  const snapshot = useActivitySnapshot<ActivityRow[]>(user?.id, scope, [], load);
  const { data: rows, loading, setData: setRows } = snapshot;

  // Realtime subscription
  useEffect(() => {
    if (!user || snapshot.offline) return;
    const channel = (supabase as any)
      .channel(`activity-feed-${user.id}-${options.userId ?? 'self'}-${options.branchId ?? 'all'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload: any) => {
        const r = payload.new as ActivityRow;
        if (options.userId && r.user_id !== options.userId) return;
        if (!options.userId && !options.ownerScope && r.user_id !== user.id) return;
        if (options.ownerScope && profile?.role === 'owner' && r.owner_id !== profile.id) return;
        if (options.branchId && r.branch_id !== options.branchId) return;
        const range = computeRange();
        if (range) {
          const ts = new Date(r.created_at);
          if (ts < range.from || ts >= range.to) return;
        }
        setRows((cur) => [r, ...cur.filter(existing => existing.id !== r.id)].slice(0, options.limit ?? 200));
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [user, profile, options.userId, options.branchId, options.ownerScope, options.limit, computeRange, snapshot.offline, setRows]);

  return { rows, loading, refetch: snapshot.refetch, banner: snapshot.banner, cacheMissing: snapshot.cacheMissing };
}
