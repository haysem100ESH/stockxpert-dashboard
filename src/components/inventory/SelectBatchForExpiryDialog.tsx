import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { getBatchesForItem, type InventoryBatch } from '@/lib/batchInventory';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchItemId: string | null;
  itemName: string;
  onUpdated?: () => void;
}

/**
 * Lets the user pick a specific batch and update its expiry date.
 * Used wherever the UI offers "edit expiry" on an item, since expiry now lives on batches.
 */
export default function SelectBatchForExpiryDialog({ open, onOpenChange, branchItemId, itemName, onUpdated }: Props) {
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [newDate, setNewDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && branchItemId) {
      setLoading(true);
      getBatchesForItem(branchItemId).then(b => {
        setBatches(b);
        setSelectedId(b[0]?.id || '');
        setNewDate(b[0]?.expiry_date || '');
        setLoading(false);
      });
    }
  }, [open, branchItemId]);

  useEffect(() => {
    const sel = batches.find(b => b.id === selectedId);
    if (sel) setNewDate(sel.expiry_date || '');
  }, [selectedId]);

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('inventory_batches')
        .update({ expiry_date: newDate || null, updated_at: new Date().toISOString() })
        .eq('id', selectedId);
      if (error) throw error;
      toast({ title: 'Expiry updated', description: 'Batch expiry date saved.' });
      window.dispatchEvent(new Event('app:refresh'));
      onUpdated?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Expiry — {itemName}</DialogTitle>
          <DialogDescription>
            Expiry dates are tracked per batch. Choose which batch to update.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No batches found for this item.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select a batch</Label>
              <RadioGroup value={selectedId} onValueChange={setSelectedId} className="max-h-60 overflow-y-auto border rounded-md p-2">
                {batches.map(b => (
                  <label key={b.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer text-sm">
                    <RadioGroupItem value={b.id} />
                    <div className="flex-1">
                      <div className="font-medium">{b.batch_number || 'No batch #'}</div>
                      <div className="text-xs text-muted-foreground">
                        Stock {b.remaining_quantity} · Current expiry: {b.expiry_date || '—'}
                      </div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>New expiry date</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !selectedId}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
