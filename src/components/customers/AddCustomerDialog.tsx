import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { UNLIMITED_SENTINEL, type CreditLimitMode } from '@/lib/creditLimit';
import { logActivity } from '@/lib/activityLog';

interface AddCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerAdded: () => void;
}

export default function AddCustomerDialog({ open, onOpenChange, onCustomerAdded }: AddCustomerDialogProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [limitMode, setLimitMode] = useState<CreditLimitMode>('auto');
  const [customLimit, setCustomLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let maxLimit: number | null;
    if (limitMode === 'auto') maxLimit = null;
    else if (limitMode === 'unlimited') maxLimit = UNLIMITED_SENTINEL;
    else {
      const v = parseFloat(customLimit);
      if (!(v >= 0)) {
        toast({ title: 'Invalid limit', description: 'Enter a non-negative amount.', variant: 'destructive' });
        return;
      }
      maxLimit = v;
    }

    setLoading(true);
    try {
      const { data: inserted, error } = await supabase.from('customers').insert({
        name: name.trim(),
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        branch_id: selectedBranch || profile?.branch_id,
        created_by: profile?.id,
        max_credit_limit: maxLimit,
      }).select('id').single();
      if (error) throw error;
      logActivity({ type: 'create_customer', entityType: 'customer', entityId: (inserted as any)?.id, next: { name: name.trim(), phone: phone.trim() || null }, metadata: { name: name.trim() } });
      toast({ title: "Success", description: "Customer added successfully" });
      setName(''); setPhone(''); setNotes(''); setLimitMode('auto'); setCustomLimit('');
      onOpenChange(false);
      onCustomerAdded();
    } catch (error) {
      toast({ title: "Error", description: "Failed to add customer", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Customer</DialogTitle>
          <DialogDescription>Add a new customer to track purchases and debts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="E.g. Equb member, Holiday payment promise, etc." />
          </div>

          <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
            <Label className="text-sm font-semibold">Credit Limit</Label>
            <RadioGroup value={limitMode} onValueChange={(v) => setLimitMode(v as CreditLimitMode)} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="auto" id="cap-auto" />
                <Label htmlFor="cap-auto" className="text-sm cursor-pointer font-normal">Auto (based on credit score)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="custom" id="cap-custom" />
                <Label htmlFor="cap-custom" className="text-sm cursor-pointer font-normal">Custom amount (ETB)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unlimited" id="cap-unlim" />
                <Label htmlFor="cap-unlim" className="text-sm cursor-pointer font-normal">Unlimited</Label>
              </div>
            </RadioGroup>
            {limitMode === 'custom' && (
              <Input
                type="number" min="0" step="0.01"
                value={customLimit}
                onChange={e => setCustomLimit(e.target.value)}
                placeholder="e.g. 7500"
                className="mt-2"
              />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add Customer'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
