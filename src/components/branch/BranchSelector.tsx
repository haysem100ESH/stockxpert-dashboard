import { useState, useEffect, useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/db';
import { cacheMeta, readMeta } from '@/lib/offline/db';
import { useOfflineStatus } from '@/lib/offline/store';
import { useAuth } from '@/hooks/useAuth';
import { loadOfflineBranches } from '@/lib/offline/gates';
import { withSignal } from '@/lib/offline/readCache';

interface Branch {
  id: string;
  name: string;
  is_main_branch: boolean;
  branch_type: string;
  /** Offline only: false when this branch was never opened on this PC. */
  available?: boolean;
}

/** Shared by the selector and offline preparation: same request, same cached branch details/IDs. */
export async function fetchAndCacheBranchDetails(profile: { id: string; role: string }, signal?: AbortSignal): Promise<Branch[]> {
  let query = supabase
    .from('pharmacy_branches')
    .select('id, name, is_main_branch, branch_type')
    .order('is_main_branch', { ascending: false })
    .order('created_at', { ascending: true });

  if (profile?.role === 'owner' && profile?.id) {
    query = query.eq('pharmacy_owner_id', profile.id);
  }

  const { data, error } = await withSignal(query, signal);
  if (error) throw error;
  await cacheMeta(`branchDetails:${profile.id}`, data || []);
  await cacheMeta(`branches:${profile.id}`, (data || []).map((branch: Branch) => branch.id));
  return data || [];
}

interface BranchSelectorProps {
  selectedBranch: string | null;
  onBranchChange: (branchId: string | null) => void;
  showAllOption?: boolean;
}

export default function BranchSelector({ selectedBranch, onBranchChange, showAllOption = true }: BranchSelectorProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [allAvailable, setAllAvailable] = useState(true);
  const { profile } = useAuth();
  const { reachable } = useOfflineStatus();

  const fetchBranches = useCallback(async () => {
    if (!profile) { setBranches([]); setLoading(false); return; }
    try {
      if (!reachable) {
        const offline = await loadOfflineBranches(profile.id);
        setBranches(offline.branches); setAllAvailable(offline.allAvailable); return;
      }
      setAllAvailable(true);
      setBranches(await fetchAndCacheBranchDetails(profile));
    } catch (error) {
      setBranches(await readMeta<Branch[]>(`branchDetails:${profile.id}`).catch(() => undefined) ?? []);
    } finally {
      setLoading(false);
    }
  }, [profile, reachable]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches, reachable]);

  useEffect(() => {
    if (!reachable) return;
    const channel = supabase
      .channel('branch-selector-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pharmacy_branches' },
        () => { fetchBranches(); }
      )
      .subscribe();

    // Also listen for explicit refetch events from same-client mutations
    const handleBranchesUpdated = () => { fetchBranches(); };
    window.addEventListener('branches-updated', handleBranchesUpdated);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('branches-updated', handleBranchesUpdated);
    };
  }, [fetchBranches, reachable]);

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={selectedBranch || 'all'} onValueChange={(value) => onBranchChange(value === 'all' ? null : value)}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select branch" />
      </SelectTrigger>
      <SelectContent>
        {showAllOption && (
          <SelectItem value="all" disabled={!reachable && !allAvailable && selectedBranch !== null}>All Branches{!reachable && !allAvailable ? ' — Not available offline' : ''}</SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id} disabled={!reachable && branch.available === false && branch.id !== selectedBranch}>
            {branch.branch_type === 'pharmacy' ? '💊' : '📦'} {branch.name} {branch.is_main_branch && '(Main)'}{!reachable && branch.available === false ? ' — Not available offline' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
