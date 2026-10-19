import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d = new Date()) { const x = startOfDay(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day); x.setDate(x.getDate()+diff); return x; }
function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

interface Counts { today: number; week: number; month: number; }

export function useActivityCounts(userId?: string) {
  const { user } = useAuth();
  const uid = userId ?? user?.id;
  const [counts, setCounts] = useState<Counts>({ today: 0, week: 0, month: 0 });

  const load = useCallback(async () => {
    if (!uid) return;
    const now = new Date();
    const fromMonth = startOfMonth(now).toISOString();
    const { data, error } = await (supabase as any)
      .from('activity_log')
      .select('created_at')
      .eq('user_id', uid)
      .gte('created_at', fromMonth);
    if (error || !data) return;
    const today = startOfDay(now).getTime();
    const week = startOfWeek(now).getTime();
    let t=0,w=0,m=0;
    for (const r of data) {
      const ts = new Date(r.created_at).getTime();
      m++;
      if (ts >= week) w++;
      if (ts >= today) t++;
    }
    setCounts({ today: t, week: w, month: m });
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!uid) return;
    const ch = (supabase as any)
      .channel(`activity-counts-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload: any) => {
        const r = payload.new;
        if (r.user_id !== uid) return;
        const ts = new Date(r.created_at).getTime();
        const now = new Date();
        const today = startOfDay(now).getTime();
        const week = startOfWeek(now).getTime();
        const month = startOfMonth(now).getTime();
        setCounts((c) => ({
          today: c.today + (ts >= today ? 1 : 0),
          week:  c.week  + (ts >= week  ? 1 : 0),
          month: c.month + (ts >= month ? 1 : 0),
        }));
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [uid]);

  return { counts, refetch: load };
}
