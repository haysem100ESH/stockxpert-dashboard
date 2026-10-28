import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useStaffPermissions } from './useStaffPermissions';
import { useOfflineStatus, signalBackupNow, signalSync } from '@/lib/offline/store';
import { enqueueOp, duplicateWarning, overlayRecords, userOps } from '@/lib/offline/ops';
import { type EntityType, type LocalOp } from '@/lib/offline/opTypes';
import { checkReachability } from '@/lib/offline/network';

export function useOfflineRecordForm(entity: EntityType) {
  const { user, profile } = useAuth(); const { selectedBranch } = useBranchContext(); const { reachable } = useOfflineStatus();
  const { getPermission, loading, uncachedOffline } = useStaffPermissions(); const qc = useQueryClient();
  const page = entity === 'medicine_code' ? 'inventory' : entity === 'customer' ? 'customers' : 'suppliers';
  const canEdit = profile?.role === 'owner' || (profile?.role === 'staff' && !loading && !uncachedOffline && getPermission(page) === 'edit');
  const offlineAllowed = !reachable && canEdit;
  const save = async (values: Record<string, unknown>, previous?: { id: string } & Record<string, unknown>) => {
    const branchId = typeof previous?.branch_id === 'string' ? previous.branch_id : selectedBranch || profile?.branch_id;
    if (!user || !branchId) throw new Error('Select a specific branch before saving offline.');
    const warning = await duplicateWarning(user.id, entity, values, previous?.id);
    await enqueueOp({ userId: user.id, branchId, opType: `${entity}.${previous ? 'update' : 'create'}`, entityId: previous?.id, values, previous });
    signalBackupNow(); signalSync(); void qc.invalidateQueries(); window.dispatchEvent(new Event('app:refresh'));
    return warning;
  };
  const shouldSaveOffline = async () => !await checkReachability();
  return { reachable, canEdit, offlineAllowed, save, shouldSaveOffline };
}
export function useRecordOverlay<T extends { id: string }>(rows: T[], entity: EntityType): T[] {
  const { user, profile } = useAuth(); const { selectedBranch } = useBranchContext();
  const [local, setLocal] = useState<{ userId: string; ops: LocalOp[] }>();
  useEffect(() => {
    if (!user) return;
    const sub = liveQuery(() => userOps(user.id)).subscribe({ next: ops => setLocal({ userId: user.id, ops }), error: () => setLocal(undefined) });
    return () => sub.unsubscribe();
  }, [user?.id]);
  if (!user || local?.userId !== user.id) return rows;
  const branch = selectedBranch || (profile?.role === 'staff' ? profile.branch_id : undefined);
  return overlayRecords(rows, local.ops, user.id, entity, branch ? [branch] : undefined);
}