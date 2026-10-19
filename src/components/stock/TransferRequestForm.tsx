import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import TransferRequestItemWizard, { type WizardResult } from './TransferRequestItemWizard';
import { logActivity } from '@/lib/activityLog';

interface LocationOption {
  id: string;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function TransferRequestForm({ open, onOpenChange, onSuccess }: Props) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [requestingLocationId, setRequestingLocationId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<WizardResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => { if (open) fetchLocations(); }, [open]);

  const fetchLocations = async () => {
    if (!profile?.id) return;

    let resolvedOwnerId = profile.id;
    if (profile.role === 'staff' && profile.branch_id) {
      const { data: branch } = await supabase
        .from('pharmacy_branches').select('pharmacy_owner_id').eq('id', profile.branch_id).maybeSingle();
      if (branch?.pharmacy_owner_id) resolvedOwnerId = branch.pharmacy_owner_id;
    }

    const { data: branchRows, error } = await supabase
      .from('pharmacy_branches').select('id, name, branch_type')
      .eq('pharmacy_owner_id', resolvedOwnerId).order('name');

    if (error) {
      toast({ title: 'Error', description: 'Failed to load branches', variant: 'destructive' });
      return;
    }

    const sorted: LocationOption[] = (branchRows || []).map((b: any) => ({
      id: b.id, name: b.name, type: b.branch_type,
    })).sort((a, b) => a.name.localeCompare(b.name));
    setLocations(sorted);

    if (profile.role === 'staff' && profile.branch_id) {
      const ok = sorted.some(l => l.id === profile.branch_id);
      setRequestingLocationId(ok ? profile.branch_id : '');
    } else {
      setRequestingLocationId(prev => (sorted.some(l => l.id === prev) ? prev : ''));
    }
    setSourceLocationId(prev => (sorted.some(l => l.id === prev) ? prev : ''));
  };

  // If branches change, drop items (they were scoped to old source/destination).
  useEffect(() => { setItems([]); }, [sourceLocationId, requestingLocationId]);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!requestingLocationId) { toast({ title: 'Error', description: 'Select requesting branch', variant: 'destructive' }); return; }
    if (!sourceLocationId) { toast({ title: 'Error', description: 'Select a source branch', variant: 'destructive' }); return; }
    if (items.length === 0) { toast({ title: 'Error', description: 'Add at least one item', variant: 'destructive' }); return; }
    if (profile?.role === 'staff' && profile.branch_id && requestingLocationId !== profile.branch_id) {
      toast({ title: 'Error', description: 'Staff can only request for their assigned branch', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-transfer-request', {
        body: {
          requestingBranchId: requestingLocationId,
          sourceBranchId: sourceLocationId,
          notes: notes || null,
          items: items.map(i => ({
            medicine_id: i.medicine_id,
            requested_quantity: i.requested_quantity,
            target_medicine_id: i.target_medicine_id,
            target_batch_id: i.target_batch_id,
            create_new_batch: i.create_new_batch,
            new_batch_number: i.new_batch_number,
            new_batch_expiry: i.new_batch_expiry,
            new_batch_purchase_price: i.new_batch_purchase_price,
          })),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Success', description: 'Transfer request submitted' });
      logActivity({
        type: 'request_stock_transfer',
        entityType: 'transfer_request',
        entityId: (data as any)?.id || null,
        metadata: { item_count: items.length, source_branch_id: sourceLocationId, requesting_branch_id: requestingLocationId, notes: notes || null },
      });
      onSuccess?.();
      onOpenChange(false);
      setRequestingLocationId(''); setSourceLocationId(''); setNotes(''); setItems([]);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to submit request', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const sourceBranches = locations.filter(l => l.id !== requestingLocationId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Transfer Request</DialogTitle>
          <DialogDescription>Map each transferred item to your branch with smart matching.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Requesting Branch *</Label>
            <Select value={requestingLocationId || undefined} onValueChange={setRequestingLocationId} disabled={profile?.role === 'staff'}>
              <SelectTrigger><SelectValue placeholder="Select your branch" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Source Branch *</Label>
            <Select value={sourceLocationId || undefined} onValueChange={setSourceLocationId}>
              <SelectTrigger><SelectValue placeholder="Select source branch" /></SelectTrigger>
              <SelectContent>
                {sourceBranches.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." rows={2} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Items</Label>
              <Button
                type="button" size="sm" variant="outline"
                disabled={!sourceLocationId || !requestingLocationId}
                onClick={() => setWizardOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />Add Item
              </Button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="p-3 border rounded-md bg-muted/30 text-sm space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{item.medicine_name} <span className="text-xs text-muted-foreground">× {item.requested_quantity}</span></div>
                    <div className="text-xs text-muted-foreground">
                      → {item.target_medicine_name}
                      {item.create_new_batch ? ' · new batch' : ' · existing batch'}
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {sourceLocationId && requestingLocationId
                  ? 'Click "Add Item" to map an item.'
                  : 'Select requesting and source branches first.'}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button>
        </DialogFooter>

        {wizardOpen && (
          <TransferRequestItemWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            sourceBranchId={sourceLocationId}
            requestingBranchId={requestingLocationId}
            onConfirm={(r) => setItems(prev => [...prev, r])}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
