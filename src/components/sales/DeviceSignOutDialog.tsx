import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Download, RefreshCw, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { exportPendingSales, exportFingerprint, isUnresolved, retryUserSales, userSales } from '@/lib/offline/deviceSafety';
import { signalSync } from '@/lib/offline/store';

export default function DeviceSignOutDialog({ userId, open, onOpenChange, onConfirm }: { userId: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (exported?: string) => Promise<void> }) {
  const [fingerprint, setFingerprint] = useState(''); const [count, setCount] = useState(0);
  const [exported, setExported] = useState<string>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) return; setExported(undefined); setError(''); setLoaded(false);
    const sub = liveQuery(() => userSales(userId)).subscribe({ next: records => { setFingerprint(exportFingerprint(records)); setCount(records.filter(isUnresolved).length); setLoaded(true); }, error: () => setError('Could not read saved sales. Sign-out is blocked to protect them.') });
    return () => sub.unsubscribe();
  }, [userId, open]);
  const act = async (work: () => Promise<unknown>) => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{count ? 'Protect your saved sales' : 'Sign out'}</DialogTitle><DialogDescription>{count ? `${count} unconfirmed sale(s) are saved on this device. Signing out anyway removes them from this device. Export a recovery copy first, or stay signed in and sync.` : 'Signing out removes your cached prices, stock and account details from this device.'}</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {count > 0 && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void act(async () => { setExported(await exportPendingSales(userId)); })}><Download className="h-4 w-4 mr-2" />Export pending sales</Button><Button variant="outline" disabled={busy} onClick={() => void act(async () => { await retryUserSales(userId); signalSync(); })}><RefreshCw className="h-4 w-4 mr-2" />Sync now</Button></div>}
    {exported && <p className="text-sm text-muted-foreground">Download requested. Keep the JSON file somewhere safe before signing out.</p>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Stay signed in</Button><Button variant={count ? 'destructive' : 'default'} disabled={!loaded || busy || (count > 0 && exported !== fingerprint)} onClick={() => void act(() => onConfirm(exported))}><LogOut className="h-4 w-4 mr-2" />{count ? 'Sign out anyway' : 'Sign out'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}