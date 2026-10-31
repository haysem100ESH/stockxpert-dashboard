import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useActivitySnapshot } from './useActivitySnapshot';
import { withSignal } from '@/lib/offline/readCache';

export interface StaffGoal {
  id: string;
  owner_id: string;
  name: string;
  goal_type: 'daily' | 'weekly' | 'monthly' | 'custom';
  target_count: number;
  start_date: string | null;
  end_date: string | null;
  assignment_scope: 'all' | 'branch' | 'staff';
  branch_id: string | null;
  active: boolean;
  created_at: string;
}

export interface GoalAssignment { id: string; goal_id: string; staff_id: string }

async function resolveOwnerId(profile: any, signal?: AbortSignal): Promise<string | null> {
  if (!profile) return null;
  if (profile.role === 'owner') return profile.id;
  if (profile.role === 'staff' && profile.branch_id) {
    const { data } = await withSignal((supabase as any)
      .from('pharmacy_branches')
      .select('pharmacy_owner_id')
      .eq('id', profile.branch_id)
      .single(), signal);
    return (data as any)?.pharmacy_owner_id ?? null;
  }
  return null;
}

export const STAFF_GOALS_SCOPE = 'goals';
/** Shared with offline preparation (pass a bound `signal`). */
export async function loadStaffGoals(profile: any, signal?: AbortSignal): Promise<{ goals: StaffGoal[]; assignments: GoalAssignment[]; ownerId: string | null }> {
  const oid = await resolveOwnerId(profile, signal);
  const { data: g, error: ge } = await withSignal((supabase as any).from('staff_goals').select('*').eq('active', true).order('created_at', { ascending: false }), signal);
  const { data: a, error: ae } = await withSignal((supabase as any).from('staff_goal_assignments').select('*'), signal);
  if (ge || ae) throw ge ?? ae;
  return { goals: (g || []) as StaffGoal[], assignments: (a || []) as GoalAssignment[], ownerId: oid };
}
/** Goals applicable to a staff user (owners have none), as the page filters them. */
export function goalsForStaff(profile: { id: string; role: string; branch_id?: string | null } | null, goals: StaffGoal[], assignments: GoalAssignment[]): StaffGoal[] {
  if (!profile || profile.role !== 'staff') return [];
  return goals.filter((g) => {
    if (g.assignment_scope === 'all') return true;
    if (g.assignment_scope === 'branch') return g.branch_id === profile.branch_id;
    if (g.assignment_scope === 'staff') return assignments.some((a) => a.goal_id === g.id && a.staff_id === profile.id);
    return false;
  });
}

export function useStaffGoals() {
  const { profile } = useAuth();

  const load = useCallback(async () => {
    if (!profile) return { goals: [], assignments: [], ownerId: null };
    return loadStaffGoals(profile);
  }, [profile]);

  const snapshot = useActivitySnapshot<{ goals: StaffGoal[]; assignments: GoalAssignment[]; ownerId: string | null }>(profile?.id, STAFF_GOALS_SCOPE, { goals: [], assignments: [], ownerId: null }, load);
  const { goals, assignments, ownerId } = snapshot.data;
  const { loading } = snapshot;

  const create = async (input: {
    name: string;
    goal_type: StaffGoal['goal_type'];
    target_count: number;
    start_date?: string | null;
    end_date?: string | null;
    assignment_scope: StaffGoal['assignment_scope'];
    branch_id?: string | null;
    staff_ids?: string[];
  }) => {
    if (snapshot.offline) throw new Error('Connect to the internet to change goals.');
    if (!ownerId) throw new Error('Owner not resolved');
    const { data, error } = await (supabase as any).from('staff_goals').insert({
      owner_id: ownerId,
      name: input.name,
      goal_type: input.goal_type,
      target_count: input.target_count,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      assignment_scope: input.assignment_scope,
      branch_id: input.branch_id ?? null,
    }).select('*').single();
    if (error) throw error;
    if (input.assignment_scope === 'staff' && input.staff_ids?.length) {
      await (supabase as any).from('staff_goal_assignments').insert(
        input.staff_ids.map((sid) => ({ goal_id: (data as any).id, staff_id: sid }))
      );
    }
    await snapshot.refetch();
    return data as StaffGoal;
  };

  const remove = async (id: string) => {
    if (snapshot.offline) throw new Error('Connect to the internet to change goals.');
    const { error } = await (supabase as any).from('staff_goals').delete().eq('id', id);
    if (error) throw error;
    await snapshot.refetch();
  };

  const setActive = async (id: string, active: boolean) => {
    if (snapshot.offline) throw new Error('Connect to the internet to change goals.');
    const { error } = await (supabase as any).from('staff_goals').update({ active }).eq('id', id);
    if (error) throw error;
    await snapshot.refetch();
  };

  /** Goals applicable to the current staff user. */
  const myGoals = (): StaffGoal[] => goalsForStaff(profile, goals, assignments);

  return { goals, assignments, loading, ownerId, create, remove, setActive, refetch: snapshot.refetch, myGoals, banner: snapshot.banner, cacheMissing: snapshot.cacheMissing, offline: snapshot.offline };
}
