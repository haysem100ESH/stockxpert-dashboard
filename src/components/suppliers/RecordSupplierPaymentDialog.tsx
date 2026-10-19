import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface RecordSupplierPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  currentDebt: number;
  onPaymentRecorded: () => void;
}

export default function RecordSupplierPaymentDialog({ open, onOpenChange, supplierId, supplierName, currentDebt, onPaymentRecorded }: RecordSupplierPaymentDialogProps) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payAmount = parseFloat(amount);
    if (payAmount <= 0) return;
    if (payAmount > currentDebt) {
      toast({ title: 'Error', description: 'Payment exceeds outstanding debt', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      // Insert payment
      const { error } = await supabase.from('supplier_payments').insert({
        supplier_id: supplierId,
        amount: payAmount,
        payment_method: paymentMethod,
        notes: notes || null,
        branch_id: selectedBranch,
        created_by: profile?.id,
      });
      if (error) throw error;

      // Update debt
      const { data: debtRecord } = await supabase
        .from('supplier_debts')
        .select('id, total_debt')
        .eq('supplier_id', supplierId)
        .maybeSingle();

      if (debtRecord) {
        await supabase.from('supplier_debts').update({
          total_debt: Math.max(0, Number(debtRecord.total_debt) - payAmount),
          last_updated: new Date().toISOString(),
        }).eq('id', debtRecord.id);
      }

      toast({ title: 'Success', description: `Payment of ETB ${payAmount.toFixed(2)} recorded for ${supplierName}` });
      setAmount(''); setNotes(''); setPaymentMethod('Cash');
      onPaymentRecorded();
    } catch {
      toast({ title: 'Error', description: 'Failed to record payment', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment — {supplierName}</DialogTitle>
          <DialogDescription>Outstanding debt: ETB {currentDebt.toFixed(2)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Amount (ETB) *</Label>
            <Input type="number" step="0.01" min="0.01" max={currentDebt} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                <SelectItem value="Cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Recording...' : 'Record Payment'}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
