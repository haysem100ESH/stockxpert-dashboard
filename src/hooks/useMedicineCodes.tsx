/**
 * useMedicineCodes
 * --------------------------------------------------------------------------
 * Owner-defined codes that group medicine variants (different batches,
 * brands, manufacturers) for combined stock reporting.
 *
 * Codes belong to an owner. Staff inherit visibility through their branch's
 * owner.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';
import { logActivity } from '@/lib/activityLog';

export interface MedicineCode {
  id: string;
  owner_id: string;
  code: string;
  label: string;
  notes: string | null;
  created_at: string;
}

const KEY = 'medicine-codes';

async function resolveOwnerId(profile: any): Promise<string | null> {
  if (!profile) return null;
  if (profile.role === 'owner') return profile.id;
  if (profile.role === 'staff' && profile.branch_id) {
    const { data } = await supabase
      .from('pharmacy_branches')
      .select('pharmacy_owner_id')
      .eq('id', profile.branch_id)
      .single();
    return (data as any)?.pharmacy_owner_id ?? null;
  }
  return null;
}

async function fetchCodes(ownerId: string | null): Promise<MedicineCode[]> {
  if (!ownerId) return [];
  const { data, error } = await (supabase as any)
    .from('medicine_codes')
    .select('id, owner_id, code, label, notes, created_at')
    .eq('owner_id', ownerId)
    .order('code');
  if (error) {
    // Table may not exist yet — fail soft.
    if ((error as any).code === '42P01') return [];
    throw error;
  }
  return (data || []) as MedicineCode[];
}

export function useMedicineCodes() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const ownerQuery = useQuery({
    queryKey: ['medicine-codes-owner', profile?.id],
    queryFn: () => resolveOwnerId(profile),
    enabled: !!profile,
    staleTime: 10 * 60 * 1000,
  });

  const ownerId = ownerQuery.data ?? null;

  const query = useQuery({
    queryKey: [KEY, ownerId],
    queryFn: () => fetchCodes(ownerId),
    enabled: !!ownerId,
    staleTime: 60 * 1000,
  });

  const create = async (input: { code: string; label: string; notes?: string }) => {
    if (!ownerId) throw new Error('Owner not resolved');
    const { data, error } = await (supabase as any)
      .from('medicine_codes')
      .insert({
        owner_id: ownerId,
        code: input.code.trim(),
        label: input.label.trim(),
        notes: input.notes?.trim() || null,
      })
      .select('id, owner_id, code, label, notes, created_at')
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: [KEY] });
    logActivity({ type: 'create_medicine_code', entityType: 'medicine_code', entityId: (data as any).id, next: { code: (data as any).code, label: (data as any).label }, metadata: { code: (data as any).code, label: (data as any).label } });
    return data as MedicineCode;
  };

  const update = async (id: string, patch: Partial<Pick<MedicineCode, 'code' | 'label' | 'notes'>>) => {
    const prev = (query.data ?? []).find((c) => c.id === id);
    const nextPatch = {
      ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: (patch.notes || '').trim() || null } : {}),
    };
    const { error } = await (supabase as any)
      .from('medicine_codes')
      .update(nextPatch)
      .eq('id', id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: [KEY] });
    logActivity({ type: 'edit_medicine_code', entityType: 'medicine_code', entityId: id, previous: prev ? { code: prev.code, label: prev.label, notes: prev.notes } : null, next: nextPatch, metadata: { code: prev?.code, label: prev?.label } });
  };

  const remove = async (id: string) => {
    const prev = (query.data ?? []).find((c) => c.id === id);
    const { error } = await (supabase as any)
      .from('medicine_codes')
      .delete()
      .eq('id', id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: [KEY] });
    qc.invalidateQueries({ queryKey: ['branch-inventory'] });
    logActivity({ type: 'delete_medicine_code', entityType: 'medicine_code', entityId: id, previous: prev ? { code: prev.code, label: prev.label } : null, metadata: { code: prev?.code, label: prev?.label } });
  };

  return {
    codes: query.data ?? [],
    loading: query.isLoading || ownerQuery.isLoading,
    ownerId,
    create,
    update,
    remove,
    refetch: query.refetch,
  };
}
