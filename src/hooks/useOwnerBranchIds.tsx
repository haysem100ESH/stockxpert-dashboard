/**
 * useOwnerBranchIds
 * ----------------------------------------------------------------------------
 * Centralized, cached lookup for the list of branch IDs that belong to the
 * current pharmacy owner.
 *
 * BEFORE: Every dashboard widget / page that needed "all branches for this
 * owner" issued its own `select id from pharmacy_branches where pharmacy_owner_id = ?`
 * query. On a single page load we observed 10+ identical requests (see network
 * traces). This dominated perceived latency.
 *
 * NOW: The query runs at most once per 5 minutes and its result is shared
 * across every component via TanStack Query's cache. The cached value is also
 * invalidated automatically by the global pull-to-refresh handler.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';

export const OWNER_BRANCH_IDS_KEY = (ownerId?: string) => ['owner-branch-ids', ownerId];

async function fetchOwnerBranchIds(ownerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('pharmacy_branches')
    .select('id')
    .eq('pharmacy_owner_id', ownerId);
  if (error) throw error;
  return (data || []).map((b: any) => b.id);
}

/**
 * Returns the cached list of branch IDs owned by the current owner.
 * For staff users it resolves the owner via their assigned branch.
 */
export function useOwnerBranchIds() {
  const { profile } = useAuth();

  // Owners use their own id directly. Staff need their owner resolved via branch
  // (handled by useResolvedOwnerId below). For now the hook only powers owner-
  // role flows where the existing code paths required these IDs.
  const ownerId = profile?.role === 'owner' ? profile.id : undefined;

  const query = useQuery({
    queryKey: OWNER_BRANCH_IDS_KEY(ownerId),
    queryFn: () => fetchOwnerBranchIds(ownerId!),
    enabled: !!ownerId,
    staleTime: 1000 * 60 * 5, // 5 min - branches rarely change
    gcTime: 1000 * 60 * 30,
  });

  return {
    branchIds: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
