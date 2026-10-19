import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Check, PackagePlus } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { formatStock, defaultPackaging, convertToUnits, availableLevels, type Packaging, type PackagingLevel } from '@/lib/packaging';

export interface WizardResult {
  medicine_id: string;            // source medicine
  medicine_name: string;
  requested_quantity: number;
  target_medicine_id: string;     // destination medicine row (may equal source)
  target_medicine_name: string;
  target_branch_item_id: string | null;
  target_batch_id: string | null;
  create_new_batch: boolean;
  new_batch_number?: string | null;
  new_batch_expiry?: string | null;
  new_batch_purchase_price?: number | null;
}

interface SourceMed {
  id: string;
  name: string;
  generic_name: string | null;
  medicine_group: string | null;
  medicine_code_id: string | null;
  unit_label: string | null;
  stock_quantity: number;
  stock_display: string;
  packaging: Packaging;
}

interface TargetMatch {
  medicine_id: string;
  name: string;
  generic_name: string | null;
  medicine_group: string | null;
  medicine_code_id: string | null;
  branch_item_id: string;
  quantity: number;
  stock_display: string;
  matchReasons: string[];
  score: number;
}

interface BatchRow {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  remaining_quantity: number;
  supplier_name?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceBranchId: string;
  requestingBranchId: string;
  onConfirm: (result: WizardResult) => void;
}

type Step = 'source' | 'target' | 'batch';

const normalize = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export default function TransferRequestItemWizard({
  open, onOpenChange, sourceBranchId, requestingBranchId, onConfirm,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('source');
  const [loading, setLoading] = useState(false);

  // Source
  const [sourceMeds, setSourceMeds] = useState<SourceMed[]>([]);
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [qtyLevel, setQtyLevel] = useState<PackagingLevel>('unit');

  // Target
  const [targets, setTargets] = useState<TargetMatch[]>([]);
  const [targetId, setTargetId] = useState('');          // medicine_id selected
  const [createNewItem, setCreateNewItem] = useState(false);

  // Batch
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchChoice, setBatchChoice] = useState<string>(''); // batch id or 'new'
  const [newBatchNumber, setNewBatchNumber] = useState('');
  const [newBatchExpiry, setNewBatchExpiry] = useState('');
  const [newBatchPrice, setNewBatchPrice] = useState<string>('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('source');
      setSourceId(''); setSourceSearch(''); setQty(1); setQtyLevel('unit');
      setTargets([]); setTargetId(''); setCreateNewItem(false);
      setBatches([]); setBatchChoice('');
      setNewBatchNumber(''); setNewBatchExpiry(''); setNewBatchPrice('');
      loadSource();
    }
  }, [open, sourceBranchId]);

  const loadSource = async () => {
    if (!sourceBranchId) return;
    setLoading(true);
    try {
      const { data: items } = await supabase
        .from('branch_items')
        .select('medicine_id, quantity')
        .eq('branch_id', sourceBranchId)
        .gt('quantity', 0);

      if (!items?.length) { setSourceMeds([]); return; }

      const ids = [...new Set(items.map((i: any) => i.medicine_id).filter(Boolean))] as string[];
      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      console.log(`[Supabase batching] medicines + medicine_packaging (TransferWizard source): ${Math.ceil(ids.length / 20)} batches for ${ids.length} ids`);
      const [medsRes, packsRes] = await Promise.all([
        chunkedInPartial<any>(ids, (chunk) =>
          supabase.from('medicines')
            .select('id, name, generic_name, medicine_group, medicine_code_id, unit_label')
            .in('id', chunk)
        , 20),
        chunkedInPartial<any>(ids, (chunk) =>
          (supabase as any).from('medicine_packaging').select('*').in('medicine_id', chunk)
        , 20),
      ]);
      const meds = medsRes.data;
      const packs = packsRes.data;
      const packMap: Record<string, Packaging> = {};
      packs.forEach((p: any) => { packMap[p.medicine_id] = p; });

      const qtyMap = new Map<string, number>();
      items.forEach((i: any) => qtyMap.set(i.medicine_id, (qtyMap.get(i.medicine_id) || 0) + Number(i.quantity || 0)));

      const out: SourceMed[] = (meds || []).map((m: any) => {
        const q = qtyMap.get(m.id) || 0;
        const pkg = packMap[m.id] || { ...defaultPackaging(), unit_name: m.unit_label || 'unit' };
        return {
          id: m.id, name: m.name,
          generic_name: m.generic_name, medicine_group: m.medicine_group,
          medicine_code_id: m.medicine_code_id, unit_label: m.unit_label,
          stock_quantity: q, stock_display: formatStock(q, pkg),
          packaging: pkg,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      setSourceMeds(out);
    } finally { setLoading(false); }
  };

  const sourceMed = useMemo(() => sourceMeds.find(m => m.id === sourceId), [sourceMeds, sourceId]);

  useEffect(() => { setQtyLevel('unit'); }, [sourceId]);

  const loadTargets = async (src: SourceMed) => {
    setLoading(true);
    try {
      const { data: items } = await supabase
        .from('branch_items')
        .select('id, medicine_id, quantity')
        .eq('branch_id', requestingBranchId);

      if (!items?.length) { setTargets([]); return; }

      const ids = [...new Set(items.map((i: any) => i.medicine_id).filter(Boolean))] as string[];
      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      console.log(`[Supabase batching] medicines + medicine_packaging (TransferWizard targets): ${Math.ceil(ids.length / 20)} batches for ${ids.length} ids`);
      const [medsRes, packsRes] = await Promise.all([
        chunkedInPartial<any>(ids, (chunk) =>
          supabase.from('medicines')
            .select('id, name, generic_name, medicine_group, medicine_code_id, unit_label')
            .in('id', chunk)
        , 20),
        chunkedInPartial<any>(ids, (chunk) =>
          (supabase as any).from('medicine_packaging').select('*').in('medicine_id', chunk)
        , 20),
      ]);
      const meds = medsRes.data;
      const packs = packsRes.data;
      const medMap: Record<string, any> = {};
      meds.forEach((m: any) => { medMap[m.id] = m; });
      const packMap: Record<string, Packaging> = {};
      packs.forEach((p: any) => { packMap[p.medicine_id] = p; });

      const srcGen = normalize(src.generic_name);
      const srcName = normalize(src.name);
      const srcTokens = srcName.split(' ').filter(t => t.length >= 3);
      const srcGrp = normalize(src.medicine_group);

      const scored: TargetMatch[] = items.map((it: any) => {
        const m = medMap[it.medicine_id];
        if (!m) return null;
        const reasons: string[] = [];
        let score = 0;
        if (src.medicine_code_id && m.medicine_code_id && src.medicine_code_id === m.medicine_code_id) {
          reasons.push('Same code'); score += 100;
        }
        if (srcGen && normalize(m.generic_name) === srcGen) {
          reasons.push('Same generic'); score += 60;
        }
        const tName = normalize(m.name);
        if (tName === srcName) { reasons.push('Same name'); score += 80; }
        else if (srcTokens.some(t => tName.includes(t))) { reasons.push('Similar name'); score += 30; }
        if (srcGrp && normalize(m.medicine_group) === srcGrp) {
          reasons.push('Same group'); score += 15;
        }
        if (score === 0) return null;
        const pkg = packMap[m.id] || { ...defaultPackaging(), unit_name: m.unit_label || 'unit' };
        return {
          medicine_id: m.id, name: m.name,
          generic_name: m.generic_name, medicine_group: m.medicine_group,
          medicine_code_id: m.medicine_code_id,
          branch_item_id: it.id,
          quantity: Number(it.quantity || 0),
          stock_display: formatStock(Number(it.quantity || 0), pkg),
          matchReasons: reasons, score,
        } as TargetMatch;
      }).filter(Boolean) as TargetMatch[];

      scored.sort((a, b) => b.score - a.score);
      setTargets(scored);
    } finally { setLoading(false); }
  };

  const loadBatches = async (branchItemId: string) => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('inventory_batches')
        .select('id, batch_number, expiry_date, remaining_quantity, supplier_id')
        .eq('branch_item_id', branchItemId)
        .gt('remaining_quantity', 0)
        .order('expiry_date', { ascending: true, nullsFirst: false });
      const rows: BatchRow[] = (data || []).map((b: any) => ({
        id: b.id, batch_number: b.batch_number, expiry_date: b.expiry_date,
        remaining_quantity: Number(b.remaining_quantity),
      }));
      // load supplier names
      const supIds = [...new Set((data || []).map((b: any) => b.supplier_id).filter(Boolean))];
      if (supIds.length) {
        const { data: sups } = await supabase.from('suppliers').select('id, name').in('id', supIds);
        const supMap: Record<string, string> = {};
        (sups || []).forEach((s: any) => { supMap[s.id] = s.name; });
        rows.forEach(r => {
          const orig = (data || []).find((b: any) => b.id === r.id);
          r.supplier_name = orig?.supplier_id ? supMap[orig.supplier_id] : null;
        });
      }
      setBatches(rows);
      setBatchChoice(rows.length === 0 ? 'new' : '');
    } finally { setLoading(false); }
  };

  const qtyInUnits = useMemo(() => {
    if (!sourceMed) return 0;
    return convertToUnits(qty, qtyLevel, sourceMed.packaging);
  }, [qty, qtyLevel, sourceMed]);

  const handleNextFromSource = () => {
    if (!sourceMed) { toast({ title: 'Pick a source item', variant: 'destructive' }); return; }
    if (!qty || qty <= 0) { toast({ title: 'Enter a valid quantity', variant: 'destructive' }); return; }
    if (qtyInUnits > sourceMed.stock_quantity) {
      toast({ title: 'Not enough stock at source', description: `Only ${sourceMed.stock_display} available.`, variant: 'destructive' }); return;
    }
    setStep('target');
    loadTargets(sourceMed);
  };

  const handleNextFromTarget = async () => {
    if (createNewItem) {
      // Create a new item in destination — fulfillment will clone source row,
      // and we go straight to "new batch" entry.
      setBatches([]); setBatchChoice('new');
      setStep('batch');
      return;
    }
    if (!targetId) { toast({ title: 'Pick the matching item in your branch', variant: 'destructive' }); return; }
    const t = targets.find(x => x.medicine_id === targetId);
    if (!t) return;
    setStep('batch');
    await loadBatches(t.branch_item_id);
  };

  const handleConfirm = () => {
    if (!sourceMed) return;
    let target_medicine_id = sourceMed.id;
    let target_medicine_name = sourceMed.name;
    let target_branch_item_id: string | null = null;
    if (!createNewItem) {
      const t = targets.find(x => x.medicine_id === targetId);
      if (!t) { toast({ title: 'No target selected', variant: 'destructive' }); return; }
      target_medicine_id = t.medicine_id;
      target_medicine_name = t.name;
      target_branch_item_id = t.branch_item_id;
    }
    const useNew = batchChoice === 'new' || createNewItem;
    if (useNew) {
      if (!newBatchExpiry) { toast({ title: 'New batch needs an expiry date', variant: 'destructive' }); return; }
    } else if (!batchChoice) {
      toast({ title: 'Pick a batch to add to', variant: 'destructive' }); return;
    }

    onConfirm({
      medicine_id: sourceMed.id,
      medicine_name: sourceMed.name,
      requested_quantity: qtyInUnits,
      target_medicine_id,
      target_medicine_name,
      target_branch_item_id,
      target_batch_id: useNew ? null : batchChoice,
      create_new_batch: useNew,
      new_batch_number: useNew ? (newBatchNumber || null) : null,
      new_batch_expiry: useNew ? newBatchExpiry : null,
      new_batch_purchase_price: useNew && newBatchPrice ? Number(newBatchPrice) : null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'source' && 'Step 1 — Select source item'}
            {step === 'target' && 'Step 2 — Match item in your branch'}
            {step === 'batch' && 'Step 3 — Choose destination batch'}
          </DialogTitle>
          <DialogDescription>
            Map a transferred item to the right medicine and batch in your branch.
          </DialogDescription>
        </DialogHeader>

        {step === 'source' && (
          <div className="space-y-4">
            <div>
              <Label>Item from source branch *</Label>
              <Input
                placeholder="Search by item name or generic name…"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                className="mb-2"
              />
              {(() => {
                const q = sourceSearch.trim().toLowerCase();
                const filtered = q
                  ? sourceMeds.filter(m =>
                      m.name.toLowerCase().includes(q) ||
                      (m.generic_name || '').toLowerCase().includes(q))
                  : sourceMeds;
                return (
                  <Select value={sourceId || undefined} onValueChange={setSourceId}>
                    <SelectTrigger><SelectValue placeholder={loading ? 'Loading…' : 'Select item'} /></SelectTrigger>
                    <SelectContent>
                      {filtered.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">No matches</div>
                      ) : filtered.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}{m.generic_name ? ` · ${m.generic_name}` : ''} (Stock: {m.stock_display})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            {sourceMed && (() => {
              const levels = availableLevels(sourceMed.packaging);
              const pkg = sourceMed.packaging;
              const levelLabel = (lv: PackagingLevel) =>
                lv === 'unit' ? (pkg.unit_name || 'unit')
                : lv === 'strip' ? (pkg.strip_name || 'strip')
                : (pkg.pack_name || 'pack');
              return (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Quantity *</Label>
                      <Input type="number" min="0" step="0.01" value={qty} onChange={e => setQty(Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>Unit</Label>
                      <Select value={qtyLevel} onValueChange={(v) => setQtyLevel(v as PackagingLevel)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {levels.map(lv => (
                            <SelectItem key={lv} value={lv}>{levelLabel(lv)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {qty > 0 && qtyLevel !== 'unit' && (
                    <p className="text-xs text-muted-foreground">
                      {qty} {levelLabel(qtyLevel)}{qty === 1 ? '' : 's'} = {qtyInUnits} {pkg.unit_name || 'unit'}{qtyInUnits === 1 ? '' : 's'} will be transferred.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {step === 'target' && sourceMed && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium">Source: {sourceMed.name}</div>
              <div className="text-muted-foreground text-xs">
                {sourceMed.generic_name && <>Generic: {sourceMed.generic_name} · </>}
                {sourceMed.medicine_group && <>Group: {sourceMed.medicine_group}</>}
              </div>
            </div>

            <Label>Add this transfer to which of your items?</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading matches…</p>
            ) : targets.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center space-y-2">
                <p className="text-sm">No matching item found in your branch.</p>
                <Button size="sm" onClick={() => { setCreateNewItem(true); }}>
                  <PackagePlus className="h-4 w-4 mr-1" /> Create new item
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {targets.map(t => (
                  <button
                    type="button"
                    key={t.medicine_id}
                    onClick={() => { setTargetId(t.medicine_id); setCreateNewItem(false); }}
                    className={`w-full text-left p-3 border rounded-md transition-colors ${
                      targetId === t.medicine_id && !createNewItem
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.generic_name && <>Generic: {t.generic_name} · </>}
                          Stock: {t.stock_display}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.matchReasons.map(r => (
                            <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      {targetId === t.medicine_id && !createNewItem && <Check className="h-4 w-4 text-primary mt-1" />}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setCreateNewItem(true); setTargetId(''); }}
                  className={`w-full text-left p-3 border rounded-md transition-colors ${
                    createNewItem ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <PackagePlus className="h-4 w-4" />
                    <span className="font-medium text-sm">None of these — create a new item</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'batch' && (
          <div className="space-y-3">
            {!createNewItem && batches.length > 0 && (
              <>
                <Label>Pick an existing batch (or create new)</Label>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {batches.map(b => (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => setBatchChoice(b.id)}
                      className={`w-full text-left p-3 border rounded-md transition-colors ${
                        batchChoice === b.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex justify-between text-sm">
                        <div>
                          <div className="font-medium">Batch {b.batch_number || '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            Expiry: {b.expiry_date ? format(new Date(b.expiry_date), 'MMM yyyy') : '—'}
                            {b.supplier_name && <> · {b.supplier_name}</>}
                          </div>
                        </div>
                        <div className="text-xs">Qty: {b.remaining_quantity}</div>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBatchChoice('new')}
                    className={`w-full text-left p-3 border rounded-md transition-colors ${
                      batchChoice === 'new' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <PackagePlus className="h-4 w-4" /> Create new batch
                    </div>
                  </button>
                </div>
              </>
            )}

            {(createNewItem || batches.length === 0 || batchChoice === 'new') && (
              <div className="space-y-3 border rounded-md p-3 bg-muted/30">
                <div className="text-sm font-medium">New batch details</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Batch number</Label>
                    <Input value={newBatchNumber} onChange={e => setNewBatchNumber(e.target.value)} placeholder="Optional" />
                  </div>
                  <div>
                    <Label className="text-xs">Expiry date *</Label>
                    <Input type="date" value={newBatchExpiry} onChange={e => setNewBatchExpiry(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Purchase price (optional)</Label>
                    <Input type="number" step="0.01" min="0" value={newBatchPrice}
                      onChange={e => setNewBatchPrice(e.target.value)}
                      placeholder="Defaults to source batch cost" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between gap-2">
          <div>
            {step !== 'source' && (
              <Button variant="ghost" onClick={() => setStep(step === 'batch' ? 'target' : 'source')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {step === 'source' && (
              <Button onClick={handleNextFromSource} disabled={!sourceId}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 'target' && (
              <Button onClick={handleNextFromTarget} disabled={!targetId && !createNewItem}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 'batch' && (
              <Button onClick={handleConfirm}>
                <Check className="h-4 w-4 mr-1" /> Add Item
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
