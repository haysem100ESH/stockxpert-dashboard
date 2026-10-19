import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { updateCreditScore, calculateScoreChange } from '@/hooks/useCreditScore';

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  outstandingAmount: number;
  creditScore?: number;
  onPaymentRecorded: () => void;
}

export default function RecordPaymentDialog({ open, onOpenChange, customerId, customerName, outstandingAmount, creditScore = 50, onPaymentRecorded }: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    setLoading(true);
    try {
      const { data: paymentRow, error } = await (supabase as any).from('customer_payments').insert({
        customer_id: customerId,
        amount: parsedAmount,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        created_by: profile?.id,
        branch_id: selectedBranch || profile?.branch_id,
      }).select('id').single();
      if (error) throw error;

      // Update customer_credits table
      const branchId = selectedBranch || profile?.branch_id;
      const { data: existingCredit } = await (supabase as any)
        .from('customer_credits')
        .select('id, total_debt')
        .eq('customer_id', customerId)
        .single();

      if (existingCredit) {
        const prevBal = Number(existingCredit.total_debt);
        const newBal = Math.max(0, prevBal - parsedAmount);
        await (supabase as any).from('customer_credits').update({ total_debt: newBal, last_updated: new Date().toISOString() }).eq('id', existingCredit.id);
        await (supabase as any).from('customer_credit_transactions').insert({
          customer_id: customerId,
          branch_id: branchId,
          transaction_type: 'payment',
          amount: parsedAmount,
          previous_balance: prevBal,
          new_balance: newBal,
          payment_id: paymentRow?.id ?? null,
          notes: notes.trim() || null,
          created_by: profile?.id ?? null,
        });
      }

      // Auto-update credit score based on payment
      const isFullPayment = parsedAmount >= outstandingAmount;
      const partialPercent = (parsedAmount / outstandingAmount) * 100;
      const scoreChange = calculateScoreChange({
        paidOnTime: isFullPayment,
        isPartialPayment: !isFullPayment,
        partialPercent: isFullPayment ? undefined : partialPercent,
      });

      if (scoreChange.change !== 0) {
        await updateCreditScore({
          customerId,
          currentScore: creditScore,
          changeAmount: scoreChange.change,
          reason: scoreChange.reason,
          notes: notes.trim() || null,
          createdBy: profile?.id,
          branchId: selectedBranch || profile?.branch_id,
        });
      }

      toast({ title: "Success", description: `Payment of ETB ${parsedAmount.toFixed(2)} recorded for ${customerName}. ${scoreChange.change !== 0 ? scoreChange.reason : ''}` });
      setAmount(''); setNotes(''); setPaymentMethod('Cash');
      onOpenChange(false);
      onPaymentRecorded();
    } catch (error) {
      toast({ title: "Error", description: "Failed to record payment", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Record Debt Payment</DialogTitle>
          <DialogDescription>
            Record a payment from <strong>{customerName}</strong>. Outstanding: <strong>ETB {outstandingAmount.toFixed(2)}</strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-amount">Amount (ETB) *</Label>
            <Input id="pay-amount" type="number" step="0.01" min="0.01" max={outstandingAmount} value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Commercial Bank of Ethiopia">Commercial Bank of Ethiopia</SelectItem>
                <SelectItem value="Awash International Bank">Awash International Bank</SelectItem>
                <SelectItem value="Bank of Abyssinia">Bank of Abyssinia</SelectItem>
                <SelectItem value="Dashen Bank">Dashen Bank</SelectItem>
                <SelectItem value="Telebirr">Telebirr</SelectItem>
                <SelectItem value="M-PESA | Safaricom">M-PESA | Safaricom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-notes">Notes</Label>
            <Textarea id="pay-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional payment notes" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Recording...' : 'Record Payment'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
