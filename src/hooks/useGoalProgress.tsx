import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import type { StaffGoal } from './useStaffGoals';

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d = new Date()) { const x = startOfDay(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day); x.setDate(x.getDate()+diff); return x; }
function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

export function goalPeriod(goal: StaffGoal): { from: Date; to: Date; key: string } {
  const now = new Date();
  if (goal.goal_type === 'daily') {
    const from = startOfDay(now);
    const to = new Date(from); to.setDate(to.getDate()+1);
    const key = from.toISOString().slice(0,10);
    return { from, to, key };
  }
  if (goal.goal_type === 'weekly') {
    const from = startOfWeek(now);
    const to = new Date(from); to.setDate(to.getDate()+7);
    const wk = Math.ceil(((+from - +new Date(from.getFullYear(),0,1)) / 86400000 + new Date(from.getFullYear(),0,1).getDay() + 1) / 7);
    return { from, to, key: `${from.getFullYear()}-W${wk}` };
  }
  if (goal.goal_type === 'monthly') {
    const from = startOfMonth(now);
    const to = new Date(from); to.setMonth(to.getMonth()+1);
    return { from, to, key: `${from.getFullYear()}-${String(from.getMonth()+1).padStart(2,'0')}` };
  }
  // custom
  const from = goal.start_date ? new Date(goal.start_date) : startOfDay(now);
  const to = goal.end_date ? new Date(goal.end_date) : new Date(now.getFullYear()+10, 0, 1);
  return { from, to, key: `custom-${goal.id}` };
}

export function useGoalProgress(goal: StaffGoal, onComplete?: (g: StaffGoal) => void) {
  const { user } = useAuth();
  const period = useMemo(() => goalPeriod(goal), [goal]);
  const [count, setCount] = useState(0);
  const [completedThisPeriod, setCompletedThisPeriod] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { count: realCount } = await (supabase as any)
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', period.from.toISOString())
      .lt('created_at', period.to.toISOString());
    setCount(realCount ?? 0);

    const { data: comp } = await (supabase as any)
      .from('staff_goal_completions')
      .select('id')
      .eq('goal_id', goal.id)
      .eq('staff_id', user.id)
      .eq('period_key', period.key)
      .maybeSingle();
    setCompletedThisPeriod(!!comp);
  }, [user, goal.id, period.from, period.to, period.key]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const ch = (supabase as any)
      .channel(`goal-progress-${goal.id}-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload: any) => {
        const r = payload.new;
        if (r.user_id !== user.id) return;
        const ts = new Date(r.created_at);
        if (ts < period.from || ts >= period.to) return;
        setCount((c) => c + 1);
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [user, goal.id, period.from, period.to]);

  // Trigger completion exactly once per period
  useEffect(() => {
    if (!user) return;
    if (completedThisPeriod) return;
    if (count < goal.target_count) return;
    (async () => {
      await (supabase as any).rpc('record_goal_completion', { p_goal_id: goal.id, p_period_key: period.key });
      setCompletedThisPeriod(true);
      onComplete?.(goal);
    })();
  }, [count, goal, period.key, completedThisPeriod, user, onComplete]);

  return {
    count,
    target: goal.target_count,
    percent: Math.min(100, Math.round((count / goal.target_count) * 100)),
    bonus: Math.max(0, count - goal.target_count),
    bonusPercent: Math.max(0, Math.round(((count - goal.target_count) / goal.target_count) * 100)),
    completed: completedThisPeriod || count >= goal.target_count,
    period,
  };
}
