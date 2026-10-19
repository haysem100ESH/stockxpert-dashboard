/**
 * useMedicineGroups
 * --------------------------------------------------------------------------
 * Returns the list of pharmacy medicine groups (default seeded ones +
 * any custom groups created by the current owner). Provides a helper to
 * add a new owner-scoped group on the fly from the Add/Edit dialogs.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';

export interface MedicineGroup {
  id: string;
  name: string;
  is_default: boolean;
  owner_id: string | null;
}

const KEY = 'medicine-groups';

async function fetchGroups(ownerId: string | null): Promise<MedicineGroup[]> {
  const { data, error } = await (supabase as any)
    .from('medicine_groups')
    .select('id, name, is_default, owner_id')
    .or(ownerId ? `is_default.eq.true,owner_id.eq.${ownerId}` : 'is_default.eq.true')
    .order('name');
  if (error) throw error;
  return (data || []) as MedicineGroup[];
}

export function useMedicineGroups() {
  const { profile } = useAuth();
  const ownerId = profile?.role === 'owner' ? profile?.id ?? null : null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [KEY, ownerId],
    queryFn: () => fetchGroups(ownerId),
    staleTime: 5 * 60 * 1000,
  });

  // Resolve owner id (works for staff too, via their branch)
  const resolveOwnerId = async (): Promise<string | null> => {
    if (profile?.role === 'owner') return profile.id;
    if (profile?.role === 'staff' && profile?.branch_id) {
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('pharmacy_owner_id')
        .eq('id', profile.branch_id)
        .single();
      return (data as any)?.pharmacy_owner_id ?? null;
    }
    return null;
  };

  const addGroup = async (name: string): Promise<MedicineGroup | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const owner = await resolveOwnerId();
    if (!owner) return null;

    // Skip if a default already covers it
    const existing = (query.data || []).find(g => g.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const { data, error } = await (supabase as any)
      .from('medicine_groups')
      .insert({ owner_id: owner, name: trimmed, is_default: false })
      .select('id, name, is_default, owner_id')
      .single();
    if (error) {
      // Could be unique-violation if another tab already added it; refetch.
      qc.invalidateQueries({ queryKey: [KEY] });
      return null;
    }
    qc.invalidateQueries({ queryKey: [KEY] });
    return data as MedicineGroup;
  };

  return {
    groups: query.data ?? [],
    loading: query.isLoading,
    addGroup,
    refetch: query.refetch,
  };
}
