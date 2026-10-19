import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { UNLIMITED_SENTINEL, getLimitMode, type CreditLimitMode } from '@/lib/creditLimit';
import { logActivity } from '@/lib/activityLog';

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  max_credit_limit_raw?: number | null;
  max_credit_limit?: number | null;
}

interface EditCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onCustomerUpdated: () => void;
}

export default function EditCustomerDialog({ open, onOpenChange, customer, onCustomerUpdated }: EditCustomerDialogProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [limitMode, setLimitMode] = useState<CreditLimitMode>('auto');
  const [customLimit, setCustomLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone || '');
      setNotes(customer.notes || '');
      // Prefer the raw stored value when available; fall back to a fresh DB lookup.
      const raw = customer.max_credit_limit_raw ?? null;
      const mode = getLimitMode(raw);
      setLimitMode(mode);
      setCustomLimit(mode === 'custom' ? String(raw) : '');

      // If raw isn't on the row (older callers), fetch it.
      if (customer.max_credit_limit_raw === undefined) {
        (async () => {
          const { data } = await (supabase as any)
            .from('customers')
            .select('max_credit_limit')
            .eq('id', customer.id)
            .maybeSingle();
          const v = data?.max_credit_limit ?? null;
          const m = getLimitMode(v);
          setLimitMode(m);
          setCustomLimit(m === 'custom' ? String(v) : '');
        })();
      }
    }
  }, [customer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !name.trim()) return;

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
      const prev = { name: customer.name, phone: customer.phone || null, notes: customer.notes || null };
      const nextVal = { name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null, max_credit_limit: maxLimit };
      const { error } = await supabase.from('customers').update(nextVal).eq('id', customer.id);
      if (error) throw error;
      logActivity({ type: 'edit_customer', entityType: 'customer', entityId: customer.id, previous: prev, next: nextVal, metadata: { name: nextVal.name } });
      toast({ title: "Success", description: "Customer updated" });
      onOpenChange(false);
      onCustomerUpdated();
    } catch (error) {
      toast({ title: "Error", description: "Failed to update customer", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Customer</DialogTitle>
          <DialogDescription>Update customer details and credit limit.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name *</Label>
            <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input id="edit-phone" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
            <Label className="text-sm font-semibold">Credit Limit</Label>
            <RadioGroup value={limitMode} onValueChange={(v) => setLimitMode(v as CreditLimitMode)} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="auto" id="ec-auto" />
                <Label htmlFor="ec-auto" className="text-sm cursor-pointer font-normal">Auto (based on credit score)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="custom" id="ec-custom" />
                <Label htmlFor="ec-custom" className="text-sm cursor-pointer font-normal">Custom amount (ETB)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unlimited" id="ec-unlim" />
                <Label htmlFor="ec-unlim" className="text-sm cursor-pointer font-normal">Unlimited</Label>
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
            <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
