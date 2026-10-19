import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuth } from '@/hooks/useAuth';
import { otherUserUnresolvedCount } from '@/lib/offline/deviceSafety';

export default function OtherCashierSalesNotice() {
  const { user } = useAuth();
  const [result, setResult] = useState<{ userId: string; count: number }>();
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const sub = liveQuery(() => otherUserUnresolvedCount(userId)).subscribe({
      next: count => setResult({ userId, count }), error: () => setResult(undefined),
    });
    return () => sub.unsubscribe();
  }, [user?.id]);
  if (!user || result?.userId !== user.id || !result.count) return null;
  return <p role="status" className="border-l-2 border-primary bg-primary/5 p-3 text-sm text-foreground">
    This PC has {result.count} unsynced sales from another cashier. They will sync when that cashier signs in here.
  </p>;
}