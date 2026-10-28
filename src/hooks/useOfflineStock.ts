import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from './useAuth';
import { useOfflineStatus, signalSync, signalBackupNow } from '@/lib/offline/store';
import { canEnqueueOp } from '@/lib/offline/ops';
import { offlineDb } from '@/lib/offline/db';

export function useOfflineStockPermission(branchId?: string) {
  const { user } = useAuth(); const { reachable } = useOfflineStatus();
  const [verified, setVerified] = useState<{ userId: string; branchId: string; allowed: boolean }>();
  useEffect(() => {
    if (!user || !branchId) { setVerified(undefined); return; }
    const sub = liveQuery(() => canEnqueueOp(user.id, 'stock', branchId)).subscribe({ next: allowed => setVerified({ userId: user.id, branchId, allowed }), error: () => setVerified(undefined) });
    return () => sub.unsubscribe();
  }, [user?.id, branchId]);
  return { reachable, allowed: !!user && verified?.userId === user.id && verified.branchId === branchId && verified.allowed };
}
export const stockQueued = () => { signalBackupNow(); signalSync(); window.dispatchEvent(new Event('pos:stock')); };