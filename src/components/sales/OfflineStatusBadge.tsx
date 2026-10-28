import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useOfflineStatus } from '@/lib/offline/store';
import { Button } from '@/components/ui/button';
import PendingSalesSheet from './PendingSalesSheet';

export default function OfflineStatusBadge() {
  const { connection, pendingCount, needsAttentionCount, lastSuccessfulSync } = useOfflineStatus();
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  const label = connection === 'needs_attention' ? `Needs attention (${needsAttentionCount})`
    : connection === 'sign_in_required' ? 'Sign in required'
    : connection === 'syncing' ? 'Syncing' : connection === 'offline' ? 'Offline' : 'Online';
  return <><Button data-offline-allow variant="ghost" aria-label="Open device sales" onClick={() => setOpen(true)} className="h-auto px-1 py-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <Badge variant={connection === 'needs_attention' || connection === 'sign_in_required' ? 'destructive' : 'secondary'}>{label}</Badge>
    <span className="text-muted-foreground">{pendingCount} pending</span>
    <span className="text-muted-foreground">Last sync: {lastSuccessfulSync ? formatDistanceToNow(new Date(lastSuccessfulSync), { addSuffix: true }) : 'never'}</span>
  </Button><PendingSalesSheet open={open} onOpenChange={setOpen} /></>;
}