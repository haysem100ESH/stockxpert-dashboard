import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { getBatchesForItem, createBatch, syncBranchItemQuantity, type InventoryBatch } from '@/lib/batchInventory';
import { logActivity, logFieldChanges } from '@/lib/activityLog';

interface BatchesEditorProps {
  branchId: string;
  medicineId: string;
  branchItemId: string;
  defaultPurchasePrice: number;
  defaultSellingPrice: number;
  onChanged?: () => void;
}

type DraftBatch = {
  id: string;            // existing UUID or `new-${idx}`
  isNew: boolean;
  batch_number: string;
  remaining_quantity: string;
  purchase_price: string;
  selling_price: string;
  expiry_date: string;
  min_stock_level: string;     // per-batch low-stock override ('' = none)
  expiry_alert_days: string;   // per-batch expiry alert window ('' = use global)
  _original?: InventoryBatch;
};

export default function BatchesEditor({
  branchId, medicineId, branchItemId,
  defaultPurchasePrice, defaultSellingPrice, onChanged,
}: BatchesEditorProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<DraftBatch[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await getBatchesForItem(branchItemId);
    setDrafts(data.map(b => ({
      id: b.id,
      isNew: false,
      batch_number: b.batch_number || '',
      remaining_quantity: String(b.remaining_quantity ?? 0),
      purchase_price: String(b.purchase_price ?? 0),
      selling_price: String(b.selling_price ?? 0),
      expiry_date: b.expiry_date || '',
      min_stock_level: (b as any).min_stock_level != null ? String((b as any).min_stock_level) : '',
      expiry_alert_days: (b as any).expiry_alert_days != null ? String((b as any).expiry_alert_days) : '',
      _original: b,
    })));
    setDeletedIds([]);
    setLoading(false);
  };

  useEffect(() => { if (branchItemId) load(); }, [branchItemId]);

  const totalQty = drafts.reduce((s, d) => s + (parseFloat(d.remaining_quantity) || 0), 0);

  const addBatch = () => {
    setDrafts(d => [...d, {
      id: `new-${Date.now()}-${d.length}`,
      isNew: true,
      batch_number: '',
      remaining_quantity: '0',
      purchase_price: String(defaultPurchasePrice ?? 0),
      selling_price: String(defaultSellingPrice ?? 0),
      expiry_date: '',
      min_stock_level: '',
      expiry_alert_days: '',
    }]);
  };

  const updateField = (id: string, field: keyof DraftBatch, value: string) => {
    setDrafts(d => d.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const removeBatch = (id: string) => {
    setDrafts(d => d.filter(b => b.id !== id));
    if (!id.startsWith('new-')) setDeletedIds(ids => [...ids, id]);
  };

  const hasMissingBatchNumber = drafts.some(d => !d.batch_number.trim());

  const save = async () => {
    if (hasMissingBatchNumber) {
      toast({ title: 'Batch number is required', description: 'Please enter a batch number for every batch.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Resolve item name once for history logs
      const { data: medRow } = await supabase
        .from('medicines')
        .select('name')
        .eq('id', medicineId)
        .maybeSingle();
      const itemName = (medRow as any)?.name || 'Unknown Item';

      const historyRows: any[] = [];
      const baseLog = (action_type: string, field_name: string, oldVal: any, newVal: any, reason: string) => ({
        medicine_id: medicineId,
        branch_id: branchId || null,
        action_type,
        field_name,
        old_value: oldVal == null ? '' : String(oldVal),
        new_value: newVal == null ? '' : String(newVal),
        reason,
        done_by: profile?.id || null,
        done_by_name: profile?.full_name || 'Unknown',
        item_name: itemName,
      });

      for (const id of deletedIds) {
        const { data: delBatch } = await supabase
          .from('inventory_batches')
          .select('batch_number, remaining_quantity')
          .eq('id', id)
          .maybeSingle();
        const bn = (delBatch as any)?.batch_number || '—';
        const rem = (delBatch as any)?.remaining_quantity ?? 0;
        const { error } = await supabase.from('inventory_batches').delete().eq('id', id);
        if (error) throw error;
        historyRows.push(baseLog(
          'Batch Deleted',
          'inventory_batches',
          `Batch #${bn} (qty ${rem})`,
          '—',
          'Deleted batch via Batches tab',
        ));
        logActivity({
          type: 'delete_batch',
          entityType: 'batch',
          entityId: id,
          previous: { batch_number: bn, remaining_quantity: rem },
          metadata: { item_name: itemName, batch_number: bn },
        });
      }

      for (const d of drafts) {
        const qty = parseFloat(d.remaining_quantity);
        const buy = parseFloat(d.purchase_price);
        const sell = parseFloat(d.selling_price);
        if (!d.batch_number.trim()) throw new Error('Batch number is required for every batch.');
        if (isNaN(qty) || qty < 0) throw new Error(`Invalid quantity for batch "${d.batch_number}"`);
        if (isNaN(buy) || buy < 0) throw new Error(`Invalid buy price for batch "${d.batch_number}"`);
        if (isNaN(sell) || sell < 0) throw new Error(`Invalid sell price for batch "${d.batch_number}"`);

        const minStock = d.min_stock_level.trim() === '' ? null : parseFloat(d.min_stock_level);
        const alertDays = d.expiry_alert_days.trim() === '' ? null : parseInt(d.expiry_alert_days, 10);
        if (minStock !== null && (isNaN(minStock) || minStock < 0)) throw new Error(`Invalid min stock for batch "${d.batch_number}"`);
        if (alertDays !== null && (isNaN(alertDays) || alertDays < 0)) throw new Error(`Invalid alert days for batch "${d.batch_number}"`);

        if (d.isNew) {
          const { error, batch } = await createBatch({
            branchId,
            medicineId,
            branchItemId,
            batchNumber: d.batch_number.trim(),
            quantity: qty,
            purchasePrice: buy,
            sellingPrice: sell,
            expiryDate: d.expiry_date || null,
            createdBy: user?.id || null,
          });
          if (error) throw error;
          if (batch && (minStock !== null || alertDays !== null)) {
            await supabase.from('inventory_batches').update({
              min_stock_level: minStock,
              expiry_alert_days: alertDays,
            }).eq('id', batch.id);
          }
          historyRows.push(baseLog(
            'New Batch Added',
            'inventory_batches',
            '—',
            `Batch #${d.batch_number.trim()} · qty ${qty} · PP ${buy} / SP ${sell}${d.expiry_date ? ` · exp ${d.expiry_date}` : ''}`,
            'Added new batch via Batches tab',
          ));
          logActivity({
            type: 'create_batch',
            entityType: 'batch',
            entityId: batch?.id,
            next: {
              batch_number: d.batch_number.trim(),
              stock_quantity: qty,
              buy_price: buy,
              sell_price: sell,
              expiry_date: d.expiry_date || null,
              low_stock_alert: minStock,
              alert_before_days: alertDays,
            },
            metadata: { item_name: itemName, batch_number: d.batch_number.trim() },
          });
        } else {
          const orig = d._original!;
          const update: any = {
            batch_number: d.batch_number.trim(),
            purchase_price: buy,
            selling_price: sell,
            expiry_date: d.expiry_date || null,
            min_stock_level: minStock,
            expiry_alert_days: alertDays,
            updated_at: new Date().toISOString(),
          };
          update.remaining_quantity = qty;
          if (qty > Number(orig.quantity)) update.quantity = qty;
          const { error } = await supabase.from('inventory_batches').update(update).eq('id', d.id);
          if (error) throw error;

          const bnLabel = `Batch #${d.batch_number.trim() || orig.batch_number || '—'}`;
          const fieldDiffs: Array<[string, any, any]> = [
            ['batch_number', orig.batch_number || '—', d.batch_number.trim() || '—'],
            ['remaining_quantity', Number(orig.remaining_quantity), qty],
            ['purchase_price', Number(orig.purchase_price), buy],
            ['selling_price', Number(orig.selling_price), sell],
            ['expiry_date', orig.expiry_date || '—', d.expiry_date || '—'],
            ['min_stock_level', (orig as any).min_stock_level ?? '—', minStock ?? '—'],
            ['expiry_alert_days', (orig as any).expiry_alert_days ?? '—', alertDays ?? '—'],
          ];
          for (const [field, oldVal, newVal] of fieldDiffs) {
            if (String(oldVal) !== String(newVal)) {
              const action = field === 'remaining_quantity'
                ? (Number(newVal) > Number(oldVal) ? 'Stock Increased' : 'Stock Decreased')
                : 'Batch Modified';
              historyRows.push(baseLog(action, `${bnLabel} · ${field}`, oldVal, newVal, 'Edited batch via Batches tab'));
            }
          }

          // Detailed per-field activity logging for this batch.
          const batchMeta = { item_name: itemName, batch_number: d.batch_number.trim() || orig.batch_number };
          await logFieldChanges('edit_batch', {
            'Batch Number':       [orig.batch_number, d.batch_number.trim()],
            'Stock Quantity':     [Number(orig.remaining_quantity), qty],
            'Buy Price':          [Number(orig.purchase_price), buy],
            'Sell Price':         [Number(orig.selling_price), sell],
            'Expiry Date':        [orig.expiry_date, d.expiry_date || null],
            'Low Stock Alert':    [(orig as any).min_stock_level, minStock],
            'Alert Before (days)':[(orig as any).expiry_alert_days, alertDays],
          }, { entityType: 'batch', entityId: d.id, metadata: batchMeta });
        }
      }

      if (historyRows.length > 0) {
        try {
          await (supabase as any).from('stock_edit_history').insert(historyRows);
        } catch (e) {
          console.warn('Failed to log batch history:', e);
        }
      }

      await syncBranchItemQuantity(branchItemId);

      // Propagate latest batch's prices to branch_items + medicine_packaging
      // so the inventory card and Sales screen reflect the edited values.
      const newDrafts = drafts.filter(d => d.isNew);
      const existingDrafts = drafts.filter(d => !d.isNew);
      const latest =
        newDrafts[newDrafts.length - 1] ||
        [...existingDrafts].sort((a, b) =>
          String(b._original?.created_at || '').localeCompare(String(a._original?.created_at || ''))
        )[0];

      if (latest) {
        const sell = parseFloat(latest.selling_price);
        const buy = parseFloat(latest.purchase_price);
        if (!isNaN(sell) && !isNaN(buy)) {
          await supabase
            .from('branch_items')
            .update({ selling_price: sell, purchase_price: buy, updated_at: new Date().toISOString() })
            .eq('id', branchItemId);

          const { data: bi } = await supabase
            .from('branch_items')
            .select('units_per_pack')
            .eq('id', branchItemId)
            .maybeSingle();
          const upp = Math.max(1, Number((bi as any)?.units_per_pack || 1));
          await supabase
            .from('medicine_packaging')
            .update({ unit_selling_price: sell / upp })
            .eq('medicine_id', medicineId);
        }
      }

      // Force-refresh all caches that show prices/stock derived from this item.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['branch-inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['medicine_packaging'] }),
        queryClient.invalidateQueries({ queryKey: ['medicine_packaging_map'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory_batches'] }),
      ]);
      toast({ title: 'Batches saved', description: 'Item batches updated successfully.' });
      window.dispatchEvent(new Event('app:refresh'));
      onChanged?.();
      await load();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">Total stock (sum of batches): </span>
          <span className="font-semibold">{totalQty}</span>
          <Badge variant="outline" className="ml-2 text-xs">{drafts.length} batch{drafts.length !== 1 ? 'es' : ''}</Badge>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addBatch}>
          <Plus className="h-4 w-4 mr-1" /> Add Batch
        </Button>
      </div>

      <div className="overflow-x-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">Batch #</TableHead>
              <TableHead className="min-w-[90px]">Stock</TableHead>
              <TableHead className="min-w-[110px]">Buy Price</TableHead>
              <TableHead className="min-w-[110px]">Sell Price</TableHead>
              <TableHead className="min-w-[150px]">Expiry</TableHead>
              <TableHead className="min-w-[110px]" title="Alert when this batch's remaining stock falls to or below this number. Leave empty to disable.">Low Stock Alert</TableHead>
              <TableHead className="min-w-[120px]" title="Alert this many days before this batch's expiry date. Leave empty to use the global setting from the Alerts page.">Alert Before (days)</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                  No batches yet. Click <strong>Add Batch</strong> to create one.
                </TableCell>
              </TableRow>
            ) : drafts.map(d => {
              const missingBN = !d.batch_number.trim();
              return (
              <TableRow key={d.id}>
                <TableCell className="align-top">
                  <Input
                    value={d.batch_number}
                    onChange={e => updateField(d.id, 'batch_number', e.target.value)}
                    placeholder="e.g. BN-001"
                    className={missingBN ? 'border-destructive focus-visible:ring-destructive' : ''}
                    aria-invalid={missingBN}
                  />
                  {missingBN && (
                    <p className="text-[11px] text-destructive mt-1">Batch number is required.</p>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Input type="number" step="0.01" min="0" value={d.remaining_quantity} onChange={e => updateField(d.id, 'remaining_quantity', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Input type="number" step="0.01" min="0" value={d.purchase_price} onChange={e => updateField(d.id, 'purchase_price', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Input type="number" step="0.01" min="0" value={d.selling_price} onChange={e => updateField(d.id, 'selling_price', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Input type="date" value={d.expiry_date} onChange={e => updateField(d.id, 'expiry_date', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Input type="number" step="0.01" min="0" placeholder="—" value={d.min_stock_level} onChange={e => updateField(d.id, 'min_stock_level', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Input type="number" step="1" min="0" placeholder="global" value={d.expiry_alert_days} onChange={e => updateField(d.id, 'expiry_alert_days', e.target.value)} />
                </TableCell>
                <TableCell className="align-top">
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeBatch(d.id)} title="Delete batch">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Sales auto-deduct from the earliest-expiring batch first (FEFO). <strong>Low Stock Alert</strong> and <strong>Alert Before (days)</strong> are optional per-batch overrides — leave empty to fall back to the item / global defaults configured on the Alerts page.
      </p>

      <Button type="button" className="w-full" onClick={save} disabled={saving || hasMissingBatchNumber || drafts.length === 0}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Save Batch Changes
      </Button>
    </div>
  );
}
