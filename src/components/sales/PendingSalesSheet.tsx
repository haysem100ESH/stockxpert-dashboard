import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { offlineDb } from '@/lib/offline/db';
import { userSales, exportPendingSales, retryUserSales, discardUserSale } from '@/lib/offline/deviceSafety';
import { signalSync } from '@/lib/offline/store';
import { reasonMessage } from '@/lib/offline/rules';
import type { LocalSale, SaleStatus } from '@/lib/offline/types';

const labels: Record<SaleStatus, string> = { pending: 'Saved on device', syncing: 'Sending…', synced: 'Confirmed by server', needs_attention: 'Needs attention', voided: 'Voided by owner', discarded: 'Discarded on device' };
export default function PendingSalesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [records, setRecords] = useState<LocalSale[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [discardId, setDiscardId] = useState<string>();
  const [note, setNote] = useState('');
  const [discardBusy, setDiscardBusy] = useState(false);
  useEffect(() => {
    if (!user || !open) return;
    setLoading(true);
    const sub = liveQuery(async () => ({ records: await userSales(user.id), rows: await offlineDb.catalog.where('ownerKey').equals(user.id).toArray() }))
      .subscribe({ next: ({ records, rows }) => { setRecords(records); setBranches(Object.fromEntries(rows.map(r => [r.branchId, r.branch_name || r.branchId]))); setLoading(false); },
        error: () => { setLoading(false); toast({ title: 'Could not read device sales', variant: 'destructive' }); } });
    return () => sub.unsubscribe();
  }, [user?.id, open, toast]);
  const act = async (work: () => Promise<unknown>) => { try { await work(); } catch (e) { toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }); } };
  return <><Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl flex flex-col gap-4 p-4 sm:p-6">
    <SheetHeader><SheetTitle>Device sales</SheetTitle><SheetDescription>Saved on device is not confirmation by the server.</SheetDescription></SheetHeader>
    <Button variant="outline" className="self-start" onClick={() => { if (user) void act(() => exportPendingSales(user.id)); }}><Download className="h-4 w-4 mr-2" />Export pending sales</Button>
    <div className="overflow-y-auto flex-1 space-y-3">
      {loading ? <p className="text-muted-foreground">Loading…</p> : !records.length ? <p className="text-muted-foreground">No sales saved on this device.</p> : records.map(r => <article key={r.clientTxnId} className="rounded-md border p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-sm">{r.clientTxnId.slice(0, 8)}</span><Badge variant={r.status === 'needs_attention' ? 'destructive' : r.status === 'synced' ? 'default' : 'secondary'}>{labels[r.status]}</Badge></div>
        <p className="text-xs text-muted-foreground break-words">{new Date(r.payload.device_created_at || r.createdAt).toLocaleString()} · {r.summary.branch_name || branches[r.branchId] || r.branchId}</p>
        {r.summary.items.map((item, i) => <div key={i} className="flex justify-between gap-3 text-sm"><span className="min-w-0 break-words">{item.name} × {item.quantity}</span><span className="shrink-0">ETB {item.line_total.toFixed(2)}</span></div>)}
        <p className="font-semibold text-right">ETB {r.summary.total.toFixed(2)}</p>
        {r.status === 'needs_attention' && <div className="space-y-1 text-sm text-destructive">
          {!r.issueId && <p className="font-semibold">Refused by the server — NOT recorded. Only this device has it.</p>}
          <p>{reasonMessage(r.reasonCode, r.reasonDetail)}</p>
          {r.lastError && r.lastError !== reasonMessage(r.reasonCode, r.reasonDetail) && <p className="break-words">{r.lastError}</p>}
        </div>}
        {r.status === 'discarded' && <div className="text-sm text-muted-foreground break-words"><p>Note: {r.discardNote}</p><p>Discarded by {r.discardedBy} · {r.discardedAt && new Date(r.discardedAt).toLocaleString()}</p></div>}
        <div className="flex flex-wrap gap-2">
          {(r.status === 'pending' || (r.status === 'needs_attention' && !r.issueId)) && <Button size="sm" variant="outline" onClick={() => { if (user) void act(async () => { await retryUserSales(user.id, r.clientTxnId); signalSync(); }); }}><RefreshCw className="mr-2 h-4 w-4" />{r.status === 'pending' ? 'Retry now' : 'Retry'}</Button>}
          {r.status === 'needs_attention' && !r.issueId && <Button size="sm" variant="destructive" onClick={() => { setNote(''); setDiscardId(r.clientTxnId); }}><Trash2 className="mr-2 h-4 w-4" />Discard</Button>}
        </div>
      </article>)}
    </div>
  </SheetContent></Sheet>
    <Dialog open={!!discardId} onOpenChange={value => { if (!value && !discardBusy) setDiscardId(undefined); }}><DialogContent>
      <DialogHeader><DialogTitle>Discard device-only sale?</DialogTitle><DialogDescription>This sale was not recorded by the server. Discarding releases its stock reservation. Its history must still be exported before signing out.</DialogDescription></DialogHeader>
      <label htmlFor="discard-sale-note" className="text-sm font-medium">Required note</label>
      <Textarea id="discard-sale-note" value={note} onChange={event => setNote(event.target.value)} disabled={discardBusy} />
      <DialogFooter><Button variant="outline" disabled={discardBusy} onClick={() => setDiscardId(undefined)}>Cancel</Button><Button variant="destructive" disabled={!note.trim() || discardBusy} onClick={() => {
        if (!user || !discardId) return;
        const txnId = discardId;
        setDiscardBusy(true);
        void act(async () => { try { await discardUserSale(user.id, txnId, note); setDiscardId(undefined); } finally { setDiscardBusy(false); } });
      }}>Confirm discard</Button></DialogFooter>
    </DialogContent></Dialog></>;
}