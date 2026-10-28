import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useOfflineStockPermission, stockQueued } from '@/hooks/useOfflineStock';
import { cachedStockRows, stockContext, batchAvailableOnDevice } from '@/lib/offline/stock';
import { enqueueOp, overlayRecords, userOps } from '@/lib/offline/ops';
import { checkReachability } from '@/lib/offline/network';
import { addisDayString } from '@/lib/timezone';

export interface StockDialogItem { id: string; name: string; branch_id?: string; selling_price?: number; purchase_price: number; stock_quantity: number }
export default function OfflineStockDialog({ open, onOpenChange, item, initialMode = 'receive', onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; item: StockDialogItem; initialMode?: 'receive' | 'adjust'; onSaved: () => void;
}) {
  const { user } = useAuth(); const { toast } = useToast(); const permission = useOfflineStockPermission(item.branch_id);
  const [mode, setMode] = useState(initialMode); const [context, setContext] = useState<Awaited<ReturnType<typeof stockContext>>>();
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [values, setValues] = useState<Record<string, string>>({ quantity: '', selling_price: String(item.selling_price ?? ''), purchase_price: String(item.purchase_price), supplier_id: 'none', reason_type: 'damage', delta: '', note: '' });
  const [batchId, setBatchId] = useState(''); const [busy, setBusy] = useState(false); const [loadError, setLoadError] = useState('');
  const identity = useRef<{ opId: string; entityId: string }>();
  useEffect(() => {
    if (!user || !item.branch_id || !open) return;
    const sub = liveQuery(async () => {
      const c = await stockContext(user.id, item.id, item.branch_id ?? '');
      const rows = (await cachedStockRows('suppliers', user.id)).filter(s => !s.branch_id || s.branch_id === item.branch_id);
      return { c, suppliers: overlayRecords(rows as Array<{ id: string; name: string }>, await userOps(user.id), user.id, 'supplier', [item.branch_id ?? '']) };
    }).subscribe({ next: ({ c, suppliers }) => { setContext(c); setSuppliers(suppliers); setLoadError(''); }, error: () => setLoadError('Saved stock could not be read on this PC.') });
    return () => sub.unsubscribe();
  }, [user?.id, item.id, item.branch_id, open]);
  const field = (key: string, label: string, type = 'text') => <div><Label htmlFor={`stock-${key}`}>{label}</Label><Input id={`stock-${key}`} type={type} step={type === 'number' ? 'any' : undefined} min={type === 'date' ? addisDayString() : undefined} value={values[key] ?? ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} /></div>;
  const save = async () => {
    if (!user || !item.branch_id || busy || !permission.allowed) return;
    setBusy(true);
    try {
      if (await checkReachability()) throw new Error('Internet is back. Close this dialog and use the online stock form.');
      const target = mode === 'receive' ? undefined : batchId || item.id;
      if (!identity.current || (target && identity.current.entityId !== target)) identity.current = { opId: crypto.randomUUID(), entityId: target ?? crypto.randomUUID() };
      const payload = mode === 'receive' ? {
        branch_item_id: item.id, quantity: Number(values.quantity), selling_price: Number(values.selling_price),
        purchase_price: values.purchase_price ? Number(values.purchase_price) : undefined, expiry_date: values.expiry_date, batch_number: values.batch_number,
        supplier_id: values.supplier_id === 'none' ? undefined : values.supplier_id,
        min_stock_level: values.min_stock_level ? Number(values.min_stock_level) : undefined,
        expiry_alert_days: values.expiry_alert_days ? Number(values.expiry_alert_days) : undefined,
      } : { ...(batchId ? { batch_id: batchId } : { branch_item_id: item.id }), delta: Number(values.delta), reason_type: values.reason_type, note: values.note };
      await enqueueOp({ userId: user.id, branchId: item.branch_id, opType: mode === 'receive' ? 'stock.receive' : 'stock.adjust', ...identity.current,
        values: payload, previous: { branch_item_id: item.id } });
      identity.current = undefined; stockQueued();
      toast({ title: 'Saved on this device', description: 'Not yet confirmed by server.' }); onOpenChange(false); onSaved();
    } catch (e) { toast({ title: 'Stock change not saved', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-offline-allow className="sm:max-w-md max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{mode === 'receive' ? 'Receive stock' : 'Adjust stock'} — {item.name}</DialogTitle></DialogHeader>
    <div className="flex gap-2"><Button variant={mode === 'receive' ? 'default' : 'outline'} disabled={busy} onClick={() => { setMode('receive'); identity.current = undefined; }}>Receive stock</Button><Button variant={mode === 'adjust' ? 'default' : 'outline'} disabled={busy} onClick={() => { setMode('adjust'); identity.current = undefined; }}>Adjust stock</Button></div>
    {!permission.allowed && <p className="text-destructive">Open this page online with inventory edit permission and branch access before changing stock offline.</p>}
    {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
    {mode === 'receive' ? <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">{field('quantity', 'Quantity *', 'number')}{field('batch_number', 'Batch Number')}</div>
      <div className="grid grid-cols-2 gap-3">{field('purchase_price', 'Purchase Price', 'number')}{field('selling_price', 'Selling Price *', 'number')}</div>
      {field('expiry_date', 'Expiry Date', 'date')}
      <Label>Supplier (optional)</Label><Select value={values.supplier_id} onValueChange={v => setValues(s => ({ ...s, supplier_id: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent data-offline-allow><SelectItem value="none">— None —</SelectItem>{suppliers.map(s => <SelectItem value={s.id} key={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
      <div className="grid grid-cols-2 gap-3">{field('min_stock_level', 'Low Stock Alert', 'number')}{field('expiry_alert_days', 'Alert Before (days)', 'number')}</div>
      <p className="text-sm text-muted-foreground">Supplier purchase/payment is not recorded offline — record it online if needed.</p>
    </div> : <div className="space-y-3">
      {!context?.batchKnown && <p className="text-destructive">Open this item's batches online once before adjusting stock offline.</p>}
      {context?.batches.length ? <div className="space-y-2">{context.batches.map(b => <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
        <div className="text-sm">{b.batch_number || 'No batch #'} · {batchAvailableOnDevice(b.id, context.batches, context.sales, item.id, item.branch_id ?? '')}
          {b.offlineBadge && <Badge variant="outline" className="ml-2">{b.offlineBadge}</Badge>}{b.pendingDelta !== 0 && <Badge variant="outline" className="ml-2">{Number(b.pendingDelta) > 0 ? '+' : ''}{b.pendingDelta} pending</Badge>}</div>
        <Button size="sm" variant={batchId === b.id ? 'default' : 'outline'} onClick={() => { setBatchId(b.id); identity.current = undefined; }}>Adjust stock</Button>
      </div>)}</div> : context?.batchKnown && <p className="text-sm">Item without batches</p>}
      {field('delta', 'Amount (+ / −) *', 'number')}
      <Label>Reason *</Label><Select value={values.reason_type} onValueChange={v => setValues(s => ({ ...s, reason_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent data-offline-allow>{[['damage', 'Damaged'], ['expired', 'Expired write-off'], ['count_correction', 'Count correction'], ['other', 'Other']].map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select>
      <Label htmlFor="stock-note">Note {['count_correction', 'other'].includes(values.reason_type) ? '(required)' : '(optional)'}</Label><Textarea id="stock-note" maxLength={500} value={values.note} onChange={e => setValues(v => ({ ...v, note: e.target.value }))} />
    </div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button disabled={busy || !permission.allowed || !context?.item || (mode === 'adjust' && (!context.batchKnown || (!!context.batches.length && !batchId)))} onClick={() => void save()}>{busy ? 'Saving…' : 'Save on this device'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}