import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Download, FolderOpen, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { offlineDb } from '@/lib/offline/db';
import { userSales, exportPendingSales, exportFingerprint, isUnresolved, retryUserSales, discardUserSale } from '@/lib/offline/deviceSafety';
import { signalSync, useOfflineStatus } from '@/lib/offline/store';
import { backupSupported, setUpBackup } from '@/lib/offline/backup';
import { parseBackup, previewBackup, restoreBackup, type RestorePreview } from '@/lib/offline/restore';
import type { BackupDocument } from '@/lib/offline/backup';

const mb = (n?: number) => n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`;
import { reasonMessage } from '@/lib/offline/rules';
import type { LocalSale, SaleStatus } from '@/lib/offline/types';

const labels: Record<SaleStatus, string> = { pending: 'Saved on device', syncing: 'Sending…', synced: 'Confirmed by server', needs_attention: 'Needs attention', voided: 'Voided by owner', discarded: 'Discarded on device' };
export default function PendingSalesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, removeMyDeviceData } = useAuth(); const { toast } = useToast();
  const [records, setRecords] = useState<LocalSale[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [discardId, setDiscardId] = useState<string>();
  const [note, setNote] = useState('');
  const [discardBusy, setDiscardBusy] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [exported, setExported] = useState<string>();
  const [recordsUserId, setRecordsUserId] = useState<string>();
  const { storage } = useOfflineStatus();
  const [restore, setRestore] = useState<{ doc: BackupDocument; preview: RestorePreview; name: string }>();
  const [restoreBusy, setRestoreBusy] = useState(false);
  const pickRestoreFile = async (file: File | undefined) => {
    if (!file || !user) return;
    try { const doc = parseBackup(await file.text(), user.id); setRestore({ doc, preview: previewBackup(doc), name: file.name }); }
    catch (e) { toast({ title: `${file.name}: cannot restore`, description: e instanceof Error ? e.message : 'Invalid file.', variant: 'destructive' }); }
  };
  useEffect(() => {
    if (!user || !open) return;
    setLoading(true); setRecords([]); setBranches({}); setExported(undefined); setRetireOpen(false);
    const sub = liveQuery(async () => ({ records: await userSales(user.id), rows: await offlineDb.catalog.where('ownerKey').equals(user.id).toArray() }))
      .subscribe({ next: ({ records, rows }) => { setRecordsUserId(user.id); setRecords(records); setBranches(Object.fromEntries(rows.map(r => [r.branchId, r.branch_name || r.branchId]))); setLoading(false); },
        error: () => { setLoading(false); toast({ title: 'Could not read device sales', variant: 'destructive' }); } });
    return () => sub.unsubscribe();
  }, [user?.id, open, toast]);
  const ownRecords = recordsUserId === user?.id ? records : [];
  const removalBlocked = loading || recordsUserId !== user?.id || (ownRecords.some(isUnresolved) && exported !== exportFingerprint(ownRecords));
  const act = async (work: () => Promise<unknown>) => { try { await work(); } catch (e) { toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }); } };
  return <><Sheet open={open} onOpenChange={onOpenChange}><SheetContent data-offline-allow className="w-full sm:max-w-xl flex flex-col gap-4 p-4 sm:p-6">
    <SheetHeader><SheetTitle>Device sales</SheetTitle><SheetDescription>Saved on device is not confirmation by the server.</SheetDescription></SheetHeader>
    <Button variant="outline" className="self-start" onClick={() => { if (user) void act(async () => setExported(await exportPendingSales(user.id))); }}><Download className="h-4 w-4 mr-2" />Export pending sales</Button>
    <div className="flex flex-wrap gap-2">
      {backupSupported()
        ? <Button variant="outline" onClick={() => { if (user) void act(() => setUpBackup(user.id)); }}><FolderOpen className="h-4 w-4 mr-2" />Set up automatic backup</Button>
        : <p className="text-sm text-muted-foreground">Automatic backup is not supported in this browser — use Export daily.</p>}
      <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="h-4 w-4 mr-2" />Restore from backup file
        <input type="file" accept="application/json,.json" className="sr-only" onChange={event => { void pickRestoreFile(event.target.files?.[0]); event.target.value = ''; }} /></label></Button>
    </div>
    {backupSupported() && <p className="text-xs text-muted-foreground">Suggested folder: Documents\PharmaXpert Backup</p>}
    <p className="text-xs text-muted-foreground">Device storage used: {mb(storage?.usage)} of {mb(storage?.quota)}</p>
    <div className="overflow-y-auto flex-1 space-y-3">
      {loading ? <p className="text-muted-foreground">Loading…</p> : !ownRecords.length ? <p className="text-muted-foreground">No sales saved on this device.</p> : ownRecords.map(r => <article key={r.clientTxnId} className="rounded-md border p-4 space-y-2">
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
    <Button variant="outline" className="self-start text-destructive" onClick={() => setRetireOpen(true)}><Trash2 className="h-4 w-4 mr-2" />Remove my data from this PC</Button>
  </SheetContent></Sheet>
    <Dialog open={retireOpen} onOpenChange={value => { if (!retireBusy) setRetireOpen(value); }}><DialogContent data-offline-allow>
      <DialogHeader><DialogTitle>Remove my data from this PC?</DialogTitle><DialogDescription>For retiring or handing over a PC only. This deletes your saved sales, prices, account cache and backup folder connection from this PC, then signs you out. Other cashiers’ data and backup files are not deleted. You will need internet to sign in again.</DialogDescription></DialogHeader>
      {ownRecords.some(isUnresolved) && <p className="text-sm text-destructive">Export your current unresolved sales, including discarded sales, and keep the downloaded file safe before removing your data.</p>}
      {exported && <p className="text-sm text-muted-foreground">Download requested. Verify the file is safely retained before confirming.</p>}
      <DialogFooter>
        <Button disabled={retireBusy} onClick={() => setRetireOpen(false)}>Keep my data</Button>
        {ownRecords.some(isUnresolved) && <Button variant="outline" disabled={retireBusy} onClick={() => { if (user) void act(async () => setExported(await exportPendingSales(user.id))); }}><Download className="h-4 w-4 mr-2" />Export pending sales</Button>}
        <Button variant="destructive" disabled={removalBlocked || retireBusy} onClick={() => {
          if (!user) return;
          setRetireBusy(true);
          void act(async () => { try { await removeMyDeviceData(exported); setRetireOpen(false); onOpenChange(false); } finally { setRetireBusy(false); } });
        }}>Confirm removal</Button>
      </DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!discardId} onOpenChange={value => { if (!value && !discardBusy) setDiscardId(undefined); }}><DialogContent data-offline-allow>
      <DialogHeader><DialogTitle>Discard device-only sale?</DialogTitle><DialogDescription>This sale was not recorded by the server. Discarding releases its stock reservation. Its history stays after sign-out and must be exported before removing your data from this PC.</DialogDescription></DialogHeader>
      <label htmlFor="discard-sale-note" className="text-sm font-medium">Required note</label>
      <Textarea id="discard-sale-note" value={note} onChange={event => setNote(event.target.value)} disabled={discardBusy} />
      <DialogFooter><Button variant="outline" disabled={discardBusy} onClick={() => setDiscardId(undefined)}>Cancel</Button><Button variant="destructive" disabled={!note.trim() || discardBusy} onClick={() => {
        if (!user || !discardId) return;
        const txnId = discardId;
        setDiscardBusy(true);
        void act(async () => { try { await discardUserSale(user.id, txnId, note); setDiscardId(undefined); } finally { setDiscardBusy(false); } });
      }}>Confirm discard</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!restore} onOpenChange={value => { if (!value && !restoreBusy) setRestore(undefined); }}><DialogContent data-offline-allow>
      <DialogHeader><DialogTitle>Restore {restore?.name}?</DialogTitle><DialogDescription>Only sales not already on this device are added. They will be sent to the server, which ignores any it already recorded.</DialogDescription></DialogHeader>
      {restore && <div className="text-sm space-y-1">
        <p>Sales in file: {restore.preview.count}</p>
        <p>Dates: {restore.preview.from && restore.preview.to ? `${new Date(restore.preview.from).toLocaleString()} – ${new Date(restore.preview.to).toLocaleString()}` : '—'}</p>
        <p>Total: ETB {restore.preview.total.toFixed(2)}</p>
        <p>Statuses: {Object.entries(restore.preview.statuses).map(([k, v]) => `${labels[k as SaleStatus] ?? k}: ${v}`).join(', ') || '—'}</p>
      </div>}
      <DialogFooter><Button variant="outline" disabled={restoreBusy} onClick={() => setRestore(undefined)}>Cancel</Button><Button disabled={restoreBusy} onClick={() => {
        if (!user || !restore) return;
        const { doc, name } = restore; setRestoreBusy(true);
        void act(async () => { try {
          const r = await restoreBackup(doc, user.id); signalSync(); setRestore(undefined);
          toast({ title: `${name}: restore finished`, description: `Restored ${r.restored}, already present ${r.present}, skipped (synced) ${r.skippedSynced}, invalid ${r.invalid}.` });
        } finally { setRestoreBusy(false); } });
      }}>Confirm restore</Button></DialogFooter>
    </DialogContent></Dialog></>;
}