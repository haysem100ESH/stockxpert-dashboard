import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { createBatch, deductFIFO, getBatchesForItem, syncBranchItemQuantity, type InventoryBatch } from '@/lib/batchInventory';
import { logActivity } from '@/lib/activityLog';

interface Medicine {
  id: string;                // branch_items.id
  medicine_id?: string;      // medicines.id (REAL FK target)
  name: string;
  stock_quantity: number;
  purchase_price: number;
  selling_price?: number;
  branch_id?: string;
  item_type?: string;
  unit_label?: string;
}

interface StockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAdjusted: () => void;
}

type Mode = 'adjust' | 'new_batch';

export default function StockAdjustmentDialog({ open, onOpenChange, medicine, onAdjusted }: StockAdjustmentDialogProps) {
  const [mode, setMode] = useState<Mode>('adjust');
  // Adjust mode
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [deductFromExpense, setDeductFromExpense] = useState(false);
  const [addToExpense, setAddToExpense] = useState(true);
  // New batch mode
  const [batchQty, setBatchQty] = useState('');
  const [batchPurchasePrice, setBatchPurchasePrice] = useState('');
  const [batchSellingPrice, setBatchSellingPrice] = useState('');
  const [batchExpiry, setBatchExpiry] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [batchRecordExpense, setBatchRecordExpense] = useState(true);
  const [batchSupplierId, setBatchSupplierId] = useState<string>('none');
  const [batchPaymentType, setBatchPaymentType] = useState<'paid' | 'credit'>('paid');
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);

  const [existingBatches, setExistingBatches] = useState<InventoryBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    if (open && medicine) {
      // Prefill new-batch defaults from current item
      setBatchPurchasePrice(String(medicine.purchase_price ?? ''));
      setBatchSellingPrice(String(medicine.selling_price ?? medicine.purchase_price ?? ''));
      // Load existing batches (active only) for the "Increase" target selector
      getBatchesForItem(medicine.id).then((all) => {
        const active = (all || []).filter(b => Number(b.remaining_quantity) > 0);
        setExistingBatches(active);
        setSelectedBatchId(active.length >= 1 ? active[0].id : '');
      });
    }
  }, [open, medicine]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from('suppliers').select('id, name').order('name');
      setSuppliers((data || []) as Array<{ id: string; name: string }>);
    })();
  }, [open]);

  const resetForm = () => {
    setMode('adjust');
    setAdjustmentType('increase');
    setQuantity('');
    setReason('');
    setDeductFromExpense(false);
    setAddToExpense(true);
    setBatchQty('');
    setBatchPurchasePrice('');
    setBatchSellingPrice('');
    setBatchExpiry('');
    setBatchNumber('');
    setBatchRecordExpense(true);
    setBatchSupplierId('none');
    setBatchPaymentType('paid');
    setExistingBatches([]);
    setSelectedBatchId('');
  };

  // Resolve real medicine_id (FK target). Falls back to lookup if not provided.
  const resolveMedicineId = async (): Promise<string | null> => {
    if (!medicine) return null;
    if (medicine.medicine_id) return medicine.medicine_id;
    const { data } = await supabase
      .from('branch_items')
      .select('medicine_id')
      .eq('id', medicine.id)
      .maybeSingle();
    return (data as any)?.medicine_id || null;
  };

  const handleAdjust = async () => {
    if (!medicine) return;
    if (!reason.trim()) {
      toast({ title: 'Error', description: 'Reason is required.', variant: 'destructive' });
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: 'Error', description: 'Enter a valid quantity greater than 0.', variant: 'destructive' });
      return;
    }
    if (adjustmentType === 'decrease' && qty > medicine.stock_quantity) {
      toast({ title: 'Error', description: 'Cannot decrease more than current stock.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const branchId = medicine.branch_id || selectedBranch;
      const medicineId = await resolveMedicineId();

      if (adjustmentType === 'increase') {
        // Add stock to an EXISTING batch (do NOT create a new batch here — use "Add New Batch" tab for that).
        if (existingBatches.length > 0) {
          const target =
            existingBatches.find(b => b.id === selectedBatchId) || existingBatches[0];
          const newRemaining = Number(target.remaining_quantity) + qty;
          const newOriginal = Number(target.quantity) + qty;
          const { error: updErr } = await supabase
            .from('inventory_batches')
            .update({
              remaining_quantity: newRemaining,
              quantity: newOriginal,
              updated_at: new Date().toISOString(),
            })
            .eq('id', target.id);
          if (updErr) throw updErr;
          await syncBranchItemQuantity(medicine.id);
        } else if (medicineId && branchId) {
          // No batches exist yet — create the first one so FIFO has something to consume.
          const { error: batchErr } = await createBatch({
            branchId,
            medicineId,
            branchItemId: medicine.id,
            quantity: qty,
            purchasePrice: medicine.purchase_price || 0,
            sellingPrice: medicine.selling_price || medicine.purchase_price || 0,
            createdBy: profile?.id || null,
          });
          if (batchErr) {
            const newStock = medicine.stock_quantity + qty;
            await supabase.from('branch_items').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', medicine.id);
          }
        } else {
          const newStock = medicine.stock_quantity + qty;
          const { error } = await supabase.from('branch_items').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', medicine.id);
          if (error) throw error;
        }
      } else {
        // Decrease: FIFO deduct from oldest batches first
        const { error: fifoErr } = await deductFIFO(medicine.id, qty);
        if (fifoErr) {
          // Fallback to direct update if no batches
          const newStock = medicine.stock_quantity - qty;
          await supabase.from('branch_items').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', medicine.id);
        }
      }

      // Log adjustment (use real medicine_id to satisfy FK)
      if (medicineId) {
        const { error: logErr } = await supabase.from('inventory_stock_adjustments').insert({
          medicine_id: medicineId,
          branch_id: branchId,
          adjustment_type: adjustmentType,
          quantity: qty,
          reason: reason.trim(),
          deduct_from_expense: adjustmentType === 'decrease' ? deductFromExpense : false,
          created_by: profile?.id || null,
        });
        if (logErr) console.warn('Failed to log adjustment:', logErr);
      }

      // Activity log
      logActivity({
        type: 'adjust_stock',
        entityType: 'branch_item',
        entityId: medicine.id,
        previous: { quantity: medicine.stock_quantity },
        next: { quantity: adjustmentType === 'increase' ? medicine.stock_quantity + qty : medicine.stock_quantity - qty },
        metadata: { item_name: medicine.name, adjustment: adjustmentType, amount: qty, reason: reason.trim() },
      });

      // Log to stock_edit_history (visible in Stock Edit History page)
      try {
        const oldStock = medicine.stock_quantity;
        const newStock = adjustmentType === 'increase' ? oldStock + qty : oldStock - qty;
        await (supabase as any).from('stock_edit_history').insert({
          medicine_id: medicineId,
          branch_id: branchId || null,
          action_type: adjustmentType === 'increase' ? 'Stock Increased' : 'Stock Decreased',
          field_name: 'stock_quantity',
          old_value: String(oldStock),
          new_value: String(newStock),
          reason: reason.trim(),
          done_by: profile?.id || null,
          done_by_name: profile?.full_name || 'Unknown',
          item_name: medicine.name,
        });
      } catch (e) {
        console.warn('Failed to log to stock_edit_history:', e);
      }

      // Record expense for stock increase if user opted in
      if (adjustmentType === 'increase' && addToExpense && medicine.purchase_price > 0) {
        const expenseAmount = qty * medicine.purchase_price;
        const unit = (medicine.unit_label || 'unit').toUpperCase();
        await supabase.from('expenses').insert({
          description: `Stock adjustment (increase): ${medicine.name} (${qty} ${unit})`,
          amount: expenseAmount,
          category: 'Stock Purchase',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      // Deduct from expenses if requested (for decrease)
      if (adjustmentType === 'decrease' && deductFromExpense) {
        const expenseAmount = qty * medicine.purchase_price;
        await supabase.from('expenses').insert({
          description: `Stock adjustment (decrease): ${medicine.name} – ${qty} units removed`,
          amount: -expenseAmount,
          category: 'Stock Adjustment',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      toast({ title: 'Success', description: `Stock ${adjustmentType}d successfully.` });
      window.dispatchEvent(new Event('app:refresh'));
      resetForm();
      onOpenChange(false);
      onAdjusted();
    } catch (err: any) {
      console.error('Stock adjustment error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to adjust stock.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddBatch = async () => {
    if (!medicine) return;
    const qty = parseFloat(batchQty);
    const pp = parseFloat(batchPurchasePrice);
    const sp = parseFloat(batchSellingPrice);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: 'Error', description: 'Enter a valid quantity.', variant: 'destructive' });
      return;
    }
    if (isNaN(pp) || pp < 0) {
      toast({ title: 'Error', description: 'Enter a valid purchase price.', variant: 'destructive' });
      return;
    }
    if (isNaN(sp) || sp < 0) {
      toast({ title: 'Error', description: 'Enter a valid selling price.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const branchId = medicine.branch_id || selectedBranch;
      const medicineId = await resolveMedicineId();
      if (!medicineId || !branchId) {
        throw new Error('Could not resolve medicine or branch context.');
      }

      const supplierId = batchSupplierId !== 'none' ? batchSupplierId : null;

      const { error: batchErr } = await createBatch({
        branchId,
        medicineId,
        branchItemId: medicine.id,
        quantity: qty,
        purchasePrice: pp,
        sellingPrice: sp,
        expiryDate: batchExpiry || null,
        batchNumber: batchNumber.trim() || null,
        supplierId,
        createdBy: profile?.id || null,
      });
      if (batchErr) throw batchErr;

      // Record supplier purchase + debt if linked
      if (supplierId) {
        const totalAmount = qty * pp;
        await supabase.from('supplier_purchases').insert({
          supplier_id: supplierId,
          item_name: medicine.name,
          quantity: qty,
          unit_cost: pp,
          total_cost: totalAmount,
          payment_type: batchPaymentType,
          branch_id: branchId,
          created_by: profile?.id || null,
        });
        if (batchPaymentType === 'credit') {
          const { data: existingDebt } = await supabase
            .from('supplier_debts')
            .select('id, total_debt')
            .eq('supplier_id', supplierId)
            .maybeSingle();
          if (existingDebt) {
            await supabase.from('supplier_debts').update({ total_debt: Number(existingDebt.total_debt) + totalAmount }).eq('id', existingDebt.id);
          } else {
            await supabase.from('supplier_debts').insert({ supplier_id: supplierId, total_debt: totalAmount });
          }
        }
      }

      // Log as an "increase" stock adjustment for audit
      const { error: logErr } = await supabase.from('inventory_stock_adjustments').insert({
        medicine_id: medicineId,
        branch_id: branchId,
        adjustment_type: 'increase',
        quantity: qty,
        reason: `New batch added${batchNumber ? ` (Batch #${batchNumber})` : ''}${batchExpiry ? ` exp ${batchExpiry}` : ''}`,
        deduct_from_expense: false,
        created_by: profile?.id || null,
      });
      if (logErr) console.warn('Failed to log batch addition:', logErr);

      // Log to stock_edit_history (visible in Stock Edit History page)
      try {
        const oldStock = medicine.stock_quantity;
        const newStock = oldStock + qty;
        await (supabase as any).from('stock_edit_history').insert({
          medicine_id: medicineId,
          branch_id: branchId || null,
          action_type: 'New Batch Added',
          field_name: 'stock_quantity',
          old_value: String(oldStock),
          new_value: String(newStock),
          reason: `Added ${qty} units${batchNumber ? ` · Batch #${batchNumber}` : ''}${batchExpiry ? ` · exp ${batchExpiry}` : ''} · PP ${pp} / SP ${sp}`,
          done_by: profile?.id || null,
          done_by_name: profile?.full_name || 'Unknown',
          item_name: medicine.name,
        });
      } catch (e) {
        console.warn('Failed to log to stock_edit_history:', e);
      }

      // Record purchase expense
      if (batchRecordExpense && pp > 0) {
        const expenseAmount = qty * pp;
        const unit = (medicine.unit_label || 'unit').toUpperCase();
        await supabase.from('expenses').insert({
          description: `Purchase of ${medicine.name} (${qty} ${unit})${batchNumber ? ` – Batch #${batchNumber}` : ''}`,
          amount: expenseAmount,
          category: 'Stock Purchase',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      toast({ title: 'Success', description: 'New batch added. It will be sold via FIFO based on expiry.' });
      window.dispatchEvent(new Event('app:refresh'));
      resetForm();
      onOpenChange(false);
      onAdjusted();
    } catch (err: any) {
      console.error('Add batch error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to add batch.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust Stock – {medicine?.name}</DialogTitle>
          <DialogDescription>Current stock: {medicine?.stock_quantity ?? 0}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="adjust">Increase / Decrease</TabsTrigger>
            <TabsTrigger value="new_batch">Add New Batch</TabsTrigger>
          </TabsList>

          <TabsContent value="adjust" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={adjustmentType === 'increase' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setAdjustmentType('increase')}
              >
                Increase
              </Button>
              <Button
                type="button"
                variant={adjustmentType === 'decrease' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setAdjustmentType('decrease')}
              >
                Decrease
              </Button>
            </div>

            <div>
              <Label>Quantity</Label>
              <Input type="number" min="0.01" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Enter quantity" />
            </div>

            {adjustmentType === 'increase' && existingBatches.length > 1 && (
              <div>
                <Label>Add to batch</Label>
                <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                  <SelectTrigger><SelectValue placeholder="Select batch to receive stock" /></SelectTrigger>
                  <SelectContent>
                    {existingBatches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {(b.batch_number || 'No batch #')} · remaining {Number(b.remaining_quantity)}
                        {b.expiry_date ? ` · exp ${b.expiry_date}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  This item has multiple batches. Choose which one should receive the new stock.
                </p>
              </div>
            )}

            <div>
              <Label>Reason (required)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter reason for adjustment" />
            </div>

            {adjustmentType === 'decrease' && (
              <div className="flex items-center space-x-2 rounded-md border p-3">
                <Checkbox id="deduct-expense" checked={deductFromExpense} onCheckedChange={(c) => setDeductFromExpense(!!c)} />
                <Label htmlFor="deduct-expense" className="text-sm cursor-pointer">
                  Deduct cost from expenses (ETB {quantity ? (parseFloat(quantity) * (medicine?.purchase_price || 0)).toFixed(2) : '0.00'})
                </Label>
              </div>
            )}

            {adjustmentType === 'increase' && (
              <div className="flex items-center space-x-2 rounded-md border p-3">
                <Checkbox id="add-expense" checked={addToExpense} onCheckedChange={(c) => setAddToExpense(!!c)} />
                <Label htmlFor="add-expense" className="text-sm cursor-pointer">
                  Add cost to expenses (ETB {quantity ? (parseFloat(quantity) * (medicine?.purchase_price || 0)).toFixed(2) : '0.00'})
                </Label>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {adjustmentType === 'increase'
                ? (existingBatches.length === 0
                    ? 'No batches yet — the first batch will be created automatically.'
                    : existingBatches.length === 1
                      ? 'Stock will be added to the existing batch (no new batch is created).'
                      : 'Stock will be added to the batch you selected above.')
                : 'Decreases consume oldest batches first (FIFO).'}
            </p>
          </TabsContent>

          <TabsContent value="new_batch" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Add a fresh batch with its own price &amp; expiry. Sales will deduct it via FIFO (earliest expiry first).
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantity *</Label>
                <Input type="number" min="0.01" step="any" value={batchQty} onChange={(e) => setBatchQty(e.target.value)} />
              </div>
              <div>
                <Label>Batch Number</Label>
                <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Purchase Price *</Label>
                <Input type="number" min="0" step="0.01" value={batchPurchasePrice} onChange={(e) => setBatchPurchasePrice(e.target.value)} />
              </div>
              <div>
                <Label>Selling Price *</Label>
                <Input type="number" min="0" step="0.01" value={batchSellingPrice} onChange={(e) => setBatchSellingPrice(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={batchExpiry} onChange={(e) => setBatchExpiry(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Supplier (optional)</Label>
                <Select value={batchSupplierId} onValueChange={setBatchSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Link supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {batchSupplierId !== 'none' && (
                <div>
                  <Label>Payment Type</Label>
                  <Select value={batchPaymentType} onValueChange={(v) => setBatchPaymentType(v as 'paid' | 'credit')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2 rounded-md border p-3">
              <Checkbox id="batch-expense" checked={batchRecordExpense} onCheckedChange={(c) => setBatchRecordExpense(!!c)} />
              <Label htmlFor="batch-expense" className="text-sm cursor-pointer">
                Record as expense (ETB {batchQty && batchPurchasePrice ? (parseFloat(batchQty) * parseFloat(batchPurchasePrice)).toFixed(2) : '0.00'})
              </Label>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          {mode === 'adjust' ? (
            <Button onClick={handleAdjust} disabled={saving || !reason.trim() || !quantity}>
              {saving ? 'Saving...' : 'Confirm'}
            </Button>
          ) : (
            <Button onClick={handleAddBatch} disabled={saving || !batchQty || !batchPurchasePrice || !batchSellingPrice}>
              {saving ? 'Adding...' : 'Add Batch'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
