import RecordSyncIssues from '@/components/offline/RecordSyncIssues';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Ban, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSyncIssues } from '@/hooks/useSyncIssues';
import { useOfflineStatus, signalSync } from '@/lib/offline/store';
import { reconcileIssue, type ReconcileAction, type SyncIssue } from '@/lib/offline/reconciliation';
import { reasonMessage } from '@/lib/offline/rules';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export default function SyncIssuesPage() {
  const { profile } = useAuth(); const { reachable } = useOfflineStatus(); const { toast } = useToast();
  const [tab, setTab] = useState('open'); const [voidIssue, setVoidIssue] = useState<SyncIssue>();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState<string>(); const [voidError, setVoidError] = useState('');
  const query = useSyncIssues(tab === 'history'); const qc = useQueryClient();
  if (profile?.role !== 'owner') return <Navigate to="/sales" replace />;
  if (!reachable) return <p>This page needs an internet connection</p>;
  const action = async (issue: SyncIssue, type: ReconcileAction) => {
    if (busy) return; setBusy(issue.id); setVoidError('');
    try {
      const result = await reconcileIssue(issue, type, type === 'void' ? note : '');
      toast({ title: result.status === 'synced' ? 'Confirmed by server' : result.status === 'voided' ? 'Voided by owner' : 'Needs attention',
        description: result.status === 'needs_attention' ? reasonMessage(result.reason_code, result.reason_detail) : `Sale ${issue.payload?.client_txn_id?.slice(0, 8) ?? issue.id.slice(0, 8)}` });
      setVoidIssue(undefined); setNote(''); signalSync(); window.dispatchEvent(new Event('app:refresh'));
    } catch (e) { const message = e instanceof Error ? e.message : 'Please refresh and try again.'; setVoidError(message); toast({ title: 'Action not confirmed', description: message, variant: 'destructive' }); }
    finally { setBusy(undefined); void qc.invalidateQueries({ queryKey: ['pos-sync-issues'] }); void qc.invalidateQueries({ queryKey: ['pos-sync-issues-count'] }); }
  };
  return <section className="mx-auto max-w-6xl space-y-5">
    <div className="flex justify-between items-center gap-3"><h1 className="text-2xl font-bold">Sync issues</h1><Button variant="outline" size="icon" title="Refresh issues" aria-label="Refresh issues" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="open">Sales</TabsTrigger><TabsTrigger value="records">Records</TabsTrigger><TabsTrigger value="history">Resolved / voided</TabsTrigger></TabsList></Tabs>
    {tab === 'records' ? <RecordSyncIssues /> : query.isLoading ? <p className="text-muted-foreground">Loading…</p> : query.isError ? <p role="alert" className="text-destructive">Could not load sync issues. Refresh to try again.</p> : !query.data?.length ? <p className="text-muted-foreground">{tab === 'open' ? 'No open sync issues.' : 'No resolved or voided issues.'}</p> : <div className="space-y-3">{query.data.map(issue => <article key={issue.id} className="border rounded-md p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold break-words">{issue.branchName || issue.branch_id}</h2><p className="text-xs text-muted-foreground break-words">{issue.submitterName || issue.submitted_by} · {new Date(issue.created_at).toLocaleString()} · {issue.payload?.client_txn_id?.slice(0, 8)}</p></div><Badge variant={issue.status === 'open' ? 'destructive' : 'secondary'}>{issue.status === 'open' ? 'Needs attention' : issue.status === 'voided' ? 'Voided by owner' : 'Resolved'}</Badge></div>
      <p className="text-sm">{reasonMessage(issue.reason_code, issue.reason_detail)}</p>
      {issue.reason_detail && <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">{Object.entries(issue.reason_detail).map(([key, value]) => <div key={key} className="break-all"><dt className="inline font-medium">{key.replace(/_/g, ' ')}: </dt><dd className="inline">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>}
      <div className="border-t pt-3 space-y-1">{issue.payload?.items?.map((item, i) => <div key={i} className="flex justify-between gap-3 text-sm"><span className="break-words min-w-0">{issue.itemNames?.[item.medicine_id] || item.medicine_id} × {item.quantity} {item.sale_type}</span><span className="shrink-0">ETB {Number(item.total_price).toFixed(2)}</span></div>)}<p className="text-right font-semibold">Total ETB {Number(issue.payload?.total_amount ?? 0).toFixed(2)}</p></div>
      {tab === 'open' && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!!busy} onClick={() => void action(issue, 'retry')}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>{issue.reason_code === 'PRICE_CHANGED' && <Button variant="outline" size="sm" disabled={!!busy} className="h-auto min-h-9 whitespace-normal text-left" onClick={() => void action(issue, 'accept_price_retry')}><Check className="mr-2 h-4 w-4 shrink-0" />Accept charged price &amp; retry</Button>}<Button variant="destructive" size="sm" disabled={!!busy} onClick={() => { setNote(''); setVoidError(''); setVoidIssue(issue); }}><Ban className="mr-2 h-4 w-4" />Void</Button></div>}
      {tab === 'history' && issue.resolution_note && <p className="text-sm text-muted-foreground break-words">{issue.resolution_note}</p>}
    </article>)}</div>}
    <Dialog open={!!voidIssue} onOpenChange={open => { if (!open && !busy) setVoidIssue(undefined); }}><DialogContent><DialogHeader><DialogTitle>Void sale</DialogTitle><DialogDescription>This sale will not be processed. A note is required.</DialogDescription></DialogHeader><label htmlFor="void-note" className="text-sm font-medium">Note</label><Textarea id="void-note" value={note} onChange={e => setNote(e.target.value)} />{voidError && <p role="alert" className="text-destructive text-sm">{voidError}</p>}<DialogFooter><Button variant="outline" onClick={() => setVoidIssue(undefined)} disabled={!!busy}>Cancel</Button><Button variant="destructive" disabled={!note.trim() || !!busy} onClick={() => { if (voidIssue) void action(voidIssue, 'void'); }}>Void sale</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}