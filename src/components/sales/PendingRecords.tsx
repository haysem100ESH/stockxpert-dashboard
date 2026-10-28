import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { opBadge, opLabel, opReason, type LocalOp } from '@/lib/offline/opTypes';
import { retryOp, discardOp } from '@/lib/offline/ops';
import { signalSync } from '@/lib/offline/store';
import { useToast } from '@/hooks/use-toast';

export default function PendingRecords({ records, userId }: { records: LocalOp[]; userId: string }) {
  const [discard, setDiscard] = useState<string>(); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); signalSync(); }
    catch (e) { toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    {!records.length && <p className="text-muted-foreground">No records saved on this device.</p>}
    {records.filter(o => o.userId === userId).map(op => <article key={op.opId} className="border rounded-md p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><strong>{opLabel(op.opType)}</strong><Badge variant={op.status === 'needs_attention' ? 'destructive' : 'secondary'}>{opBadge(op) ?? 'Confirmed by server'}</Badge></div>
      <p className="text-xs text-muted-foreground">{new Date(op.deviceCreatedAt).toLocaleString()} · {op.opId.slice(0, 8)} · {op.branchId}</p>
      <dl className="text-sm space-y-1">{Object.entries(op.payload).map(([k, v]) => <div key={k} className="break-words"><dt className="inline font-medium">{k.replace(/_/g, ' ')}: </dt><dd className="inline">{v || '—'}</dd></div>)}</dl>
      {op.status === 'needs_attention' && <p className="text-sm text-destructive">{opReason(op.reasonCode, op.details)} {op.serverIssue ? 'Waiting for owner review' : op.lastError}</p>}
      {op.discardNote && <p className="text-sm text-muted-foreground break-words">{op.discardNote}</p>}
      <div className="flex gap-2">
        {!op.serverIssue && ['pending', 'needs_attention'].includes(op.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => retryOp(userId, op.opId))}>Retry</Button>}
        {!op.serverIssue && op.status === 'needs_attention' && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setNote(''); setDiscard(op.opId); }}>Discard</Button>}
      </div>
    </article>)}
    <Dialog open={!!discard} onOpenChange={v => { if (!v && !busy) setDiscard(undefined); }}><DialogContent data-offline-allow>
      <DialogHeader><DialogTitle>Discard device-only change?</DialogTitle></DialogHeader>
      <label htmlFor="discard-record-note">Required note</label><Textarea id="discard-record-note" value={note} onChange={e => setNote(e.target.value)} />
      <DialogFooter><Button variant="outline" onClick={() => setDiscard(undefined)} disabled={busy}>Cancel</Button><Button variant="destructive" disabled={busy || !note.trim()} onClick={() => { if (discard) void act(async () => { await discardOp(userId, discard, note); setDiscard(undefined); }); }}>Confirm discard</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}