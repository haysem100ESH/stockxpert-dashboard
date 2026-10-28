import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isUnresolved, userSales } from '@/lib/offline/deviceSafety';
import { useOfflineStatus } from '@/lib/offline/store';

export default function DeviceSignOutDialog({ userId, open, onOpenChange, onConfirm }: { userId: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { reachable } = useOfflineStatus();
  useEffect(() => {
    if (!open) return;
    setCount(0); setError('');
    const sub = liveQuery(() => userSales(userId)).subscribe({ next: records => setCount(records.filter(isUnresolved).length), error: () => setError('Could not read saved sales. Signing out will not delete them.') });
    return () => sub.unsubscribe();
  }, [userId, open]);
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent data-offline-allow>
    <DialogHeader><DialogTitle>Sign out</DialogTitle><DialogDescription>{count
      ? `${count} sales are saved on this PC and are kept after you sign out. They will sync automatically the next time you sign in on this PC with internet.`
      : 'You will need internet to sign in again. Saved sales and prices stay on this PC.'}</DialogDescription></DialogHeader>
    {!reachable && <p className="text-sm text-destructive">You are offline. If you sign out now, nobody can sign in or make sales on this PC until the internet is back.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter>
      <Button autoFocus disabled={busy} onClick={() => onOpenChange(false)}>Stay signed in</Button>
      <Button variant={reachable ? 'outline' : 'destructive'} disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void onConfirm().catch(e => setError(e instanceof Error ? e.message : 'Please try again.')).finally(() => setBusy(false));
      }}><LogOut className="h-4 w-4 mr-2" />{reachable ? 'Sign out' : 'Sign out anyway'}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}