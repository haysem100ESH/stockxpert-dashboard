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
import { cacheMeta, readMeta } from '@/lib/offline/db';
import { useOfflineStatus } from '@/lib/offline/store';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';

export const OWNER_BRANCH_IDS_KEY = (ownerId?: string) => ['owner-branch-ids', ownerId];

/** Shared by the hook and offline preparation (pass `signal` to bind a preparation request). */
export async function fetchOwnerBranchIds(ownerId: string, signal?: AbortSignal): Promise<string[]> {
  if (!navigator.onLine) return await readMeta<string[]>(`branches:${ownerId}`) ?? [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const { data, error } = await supabase
    .from('pharmacy_branches')
    .select('id')
    .eq('pharmacy_owner_id', ownerId).abortSignal(signal ?? controller.signal);
  clearTimeout(timer);
  if (error) return await readMeta<string[]>(`branches:${ownerId}`) ?? [];
  const ids = (data || []).map((b: any) => b.id);
  await cacheMeta(`branches:${ownerId}`, ids);
  return ids;
}

/**
 * Returns the cached list of branch IDs owned by the current owner.
 * For staff users it resolves the owner via their assigned branch.
 */
export function useOwnerBranchIds() {
  const { profile } = useAuth();
  const { reachable } = useOfflineStatus();

  // Owners use their own id directly. Staff need their owner resolved via branch
  // (handled by useResolvedOwnerId below). For now the hook only powers owner-
  // role flows where the existing code paths required these IDs.
  const ownerId = profile?.role === 'owner' ? profile.id : undefined;

  const query = useQuery({
    queryKey: [...OWNER_BRANCH_IDS_KEY(ownerId), reachable],
    queryFn: async () => ownerId ? reachable ? fetchOwnerBranchIds(ownerId) : await readMeta<string[]>(`branches:${ownerId}`) ?? [] : [],
    networkMode: 'always',
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
