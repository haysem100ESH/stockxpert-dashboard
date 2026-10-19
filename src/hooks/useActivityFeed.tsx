import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface ActivityRow {
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
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const computeRange = useCallback(() => {
    if (options.from && options.to) return { from: options.from, to: options.to };
    if (options.date) {
      const start = new Date(options.date); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(end.getDate()+1);
      return { from: start, to: end };
    }
    return null;
  }, [options.from, options.to, options.date]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let q = (supabase as any).from('activity_log').select('*').order('created_at', { ascending: false }).limit(options.limit ?? 200);

    if (options.userId) q = q.eq('user_id', options.userId);
    else if (!options.ownerScope) q = q.eq('user_id', user.id);

    if (options.branchId) q = q.eq('branch_id', options.branchId);

    const range = computeRange();
    if (range) {
      q = q.gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString());
    }

    const { data, error } = await q;
    if (!error) setRows((data || []) as ActivityRow[]);
    setLoading(false);
  }, [user, options.userId, options.branchId, options.ownerScope, options.limit, computeRange]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
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
        setRows((cur) => [r, ...cur].slice(0, options.limit ?? 200));
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [user, profile, options.userId, options.branchId, options.ownerScope, options.limit, computeRange]);

  return { rows, loading, refetch: load };
}
