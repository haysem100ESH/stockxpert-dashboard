import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useOfflineStatus } from '@/lib/offline/store';

export default function OfflineStatusBadge() {
  const { connection, pendingCount, needsAttentionCount, lastSuccessfulSync } = useOfflineStatus();
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  const label = connection === 'needs_attention' ? `Needs attention (${needsAttentionCount})`
    : connection === 'sign_in_required' ? 'Sign in required'
    : connection === 'syncing' ? 'Syncing' : connection === 'offline' ? 'Offline' : 'Online';
  return <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <Badge variant={connection === 'needs_attention' || connection === 'sign_in_required' ? 'destructive' : 'secondary'}>{label}</Badge>
    <span className="text-muted-foreground">{pendingCount} pending</span>
    <span className="text-muted-foreground">Last sync: {lastSuccessfulSync ? formatDistanceToNow(new Date(lastSuccessfulSync), { addSuffix: true }) : 'never'}</span>
  </div>;
}