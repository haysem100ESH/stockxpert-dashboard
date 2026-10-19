import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useOfflineStatus } from '@/lib/offline/store';
import { supabase } from '@/lib/db';
import { chunkedIn } from '@/lib/supabaseBatch';
import type { SyncIssue } from '@/lib/offline/reconciliation';

export function useSyncIssueCount() {
  const { user, profile } = useAuth(); const { reachable } = useOfflineStatus();
  return useQuery({ queryKey: ['pos-sync-issues-count', user?.id], enabled: !!user && profile?.role === 'owner' && reachable,
    refetchInterval: 30_000, queryFn: async () => {
      const { count, error } = await supabase.from('pos_sync_issues').select('id', { count: 'exact', head: true }).eq('status', 'open');
      if (error) throw error; return count ?? 0;
    } });
}
export function useSyncIssues(history: boolean) {
  const { user, profile } = useAuth(); const { reachable } = useOfflineStatus();
  return useQuery({ queryKey: ['pos-sync-issues', user?.id, history], enabled: !!user && profile?.role === 'owner' && reachable,
    refetchInterval: 30_000, queryFn: async (): Promise<SyncIssue[]> => {
      let query = supabase.from('pos_sync_issues').select('*').order('created_at', { ascending: false });
      query = history ? query.neq('status', 'open') : query.eq('status', 'open');
      const { data, error } = await query; if (error) throw error;
      const rows = (data ?? []) as SyncIssue[]; if (!rows.length) return [];
      const branchIds = [...new Set(rows.map(r => r.branch_id).filter(Boolean))];
      const userIds = [...new Set(rows.map(r => r.submitted_by).filter(Boolean))];
      const medicineIds = [...new Set(rows.flatMap(r => r.payload?.items?.map(i => i.medicine_id) ?? []).filter(Boolean))];
      // RLS remains authoritative; inaccessible names fall back to their IDs.
      const [branches, profiles, medicines] = await Promise.all([
        chunkedIn<any>(branchIds, ids => supabase.from('pharmacy_branches').select('id,name').in('id', ids)).catch(() => []),
        chunkedIn<any>(userIds, ids => supabase.from('profiles').select('id,full_name').in('id', ids)).catch(() => []),
        chunkedIn<any>(medicineIds, ids => supabase.from('medicines').select('id,name').in('id', ids)).catch(() => []),
      ]);
      const names = Object.fromEntries(medicines.map(m => [m.id, m.name]));
      return rows.map(r => ({ ...r, branchName: branches.find(b => b.id === r.branch_id)?.name,
        submitterName: profiles.find(p => p.id === r.submitted_by)?.full_name, itemNames: names }));
    } });
}