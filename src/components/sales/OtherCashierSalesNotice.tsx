import { offlineDb } from '@/lib/offline/db';
import { unresolvedOp } from '@/lib/offline/opTypes';
import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from '@/hooks/useAuth';
import { otherUserUnresolvedCount } from '@/lib/offline/deviceSafety';

export default function OtherCashierSalesNotice() {
  const { user } = useAuth();
  const [result, setResult] = useState<{ userId: string; count: number; ops: number }>();
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const sub = liveQuery(async () => ({ count: await otherUserUnresolvedCount(userId), ops: await offlineDb.ops.filter(o => o.userId !== userId && unresolvedOp(o)).count() })).subscribe({
      next: value => setResult({ userId, ...value }), error: () => setResult(undefined),
    });
    return () => sub.unsubscribe();
  }, [user?.id]);
  if (!user || result?.userId !== user.id || (!result.count && !result.ops)) return null;
  return <p role="status" className="border-l-2 border-primary bg-primary/5 p-3 text-sm text-foreground">
    This PC has {result.count} unsynced sales{result.ops ? ` and ${result.ops} record changes` : ''} from another cashier. They will sync when that cashier signs in here.
  </p>;
}