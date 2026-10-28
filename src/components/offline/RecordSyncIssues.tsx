import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { useOfflineStatus, signalSync } from '@/lib/offline/store';
import { opReason } from '@/lib/offline/opTypes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { chunkedIn } from '@/lib/supabaseBatch';

export default function RecordSyncIssues() {
  const { user, profile } = useAuth(); const { branchIds } = useOwnerBranchIds(); const { reachable } = useOfflineStatus();
  const qc = useQueryClient(); const { toast } = useToast(); const [voidId, setVoidId] = useState<string>();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ['offline-op-issues', user?.id, branchIds], enabled: profile?.role === 'owner' && reachable && !!branchIds.length,
    refetchInterval: reachable ? 30_000 : false, queryFn: async () => {
      const rows = await chunkedIn<any>(branchIds, ids => supabase.from('offline_ops').select('*').in('branch_id', ids).eq('status', 'needs_attention').order('device_created_at'));
      const ids = [...new Set(rows.map(r => r.user_id ?? r.submitted_by).filter(Boolean))] as string[];
      const [profiles, branches] = await Promise.all([
        chunkedIn<any>(ids, ids => supabase.from('profiles').select('id,full_name').in('id', ids)),
        chunkedIn<any>(branchIds, ids => supabase.from('pharmacy_branches').select('id,name').in('id', ids)),
      ]);
      return rows.map(r => ({ ...r, submitter: profiles.find(p => p.id === (r.user_id ?? r.submitted_by))?.full_name,
        branch: branches.find(b => b.id === r.branch_id)?.name }));
    } });
  const action = async (id: string, action: 'retry' | 'force' | 'void') => {
    if (!reachable || profile?.role !== 'owner' || busy || (action === 'void' && !note.trim())) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('reconcile_offline_op', { p_op_id: id, p_action: action, p_note: action === 'void' ? note.trim() : '' });
      if (error) throw error;
      if (!data || !['applied', 'needs_attention', 'voided'].includes(data.status)) throw new Error('The decision was not confirmed. Refresh and try again.');
      toast({ title: data.status === 'applied' ? 'Confirmed by server' : data.status === 'voided' ? 'Voided by owner' : 'Needs attention', description: data.reason_code ? opReason(data.reason_code) : undefined });
      setVoidId(undefined); signalSync(); window.dispatchEvent(new Event('app:refresh')); void qc.invalidateQueries();
    } catch (e) { toast({ title: 'Decision not confirmed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  if (!reachable) return <p>Needs internet — records review is not available offline.</p>;
  return <div className="space-y-3">
    <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh records</Button>
    {query.isLoading ? <p>Loading…</p> : query.isError ? <p role="alert" className="text-destructive">Could not load record issues.</p> : !query.data?.length ? <p>No record issues waiting for review.</p> : query.data.map(op => {
      const details = op.details ?? op.result?.details ?? {}; const reason = op.reason_code ?? op.result?.reason_code;
      const payload = op.payload?.payload ?? op.payload ?? {};
      const path = String(op.op_type).startsWith('customer') ? '/customers' : String(op.op_type).startsWith('supplier') ? '/suppliers' : '/medicine-codes';
      return <article key={op.op_id} className="border rounded-md p-4 space-y-3">
        <div className="flex justify-between flex-wrap gap-2"><strong>{op.op_type}</strong><Badge variant="destructive">{opReason(reason)}</Badge></div>
        <p className="text-xs text-muted-foreground">{op.submitter ?? op.user_id ?? op.submitted_by} · {op.branch ?? op.branch_id} · {new Date(op.device_created_at ?? op.created_at).toLocaleString()}</p>
        {reason === 'VERSION_CONFLICT' ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[['On server', details.server], ['Offline change', details.mine ?? payload]].map(([title, values]) => <div key={String(title)}><h3 className="font-semibold">{String(title)}</h3><pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(values, null, 2)}</pre></div>)}</div>
          : <dl className="text-sm">{Object.entries(payload).map(([k, v]) => <div key={k} className="break-words"><dt className="inline font-semibold">{k}: </dt><dd className="inline">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</dd></div>)}</dl>}
        {String(reason).startsWith('DUPLICATE_') && details.existing_id && <Link className="text-primary underline" to={`${path}?record=${encodeURIComponent(details.existing_id)}`}>Existing record: {details.existing_name ?? details.existing_label ?? details.existing_id}</Link>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void action(op.op_id, 'retry')}>Retry</Button>
          {['VERSION_CONFLICT', 'DUPLICATE_PHONE', 'DUPLICATE_NAME'].includes(reason) && <Button disabled={busy} onClick={() => void action(op.op_id, 'force')}>Keep offline change</Button>}
          <Button variant="destructive" disabled={busy} onClick={() => { setNote(''); setVoidId(op.op_id); }}>Void</Button></div>
      </article>;
    })}
    <Dialog open={!!voidId} onOpenChange={v => { if (!v && !busy) setVoidId(undefined); }}><DialogContent><DialogHeader><DialogTitle>Void offline change</DialogTitle></DialogHeader>
      <label htmlFor="void-record-note">Required note</label><Textarea id="void-record-note" value={note} onChange={e => setNote(e.target.value)} />
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setVoidId(undefined)}>Cancel</Button><Button variant="destructive" disabled={busy || !note.trim()} onClick={() => { if (voidId) void action(voidId, 'void'); }}>Void change</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}