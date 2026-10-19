import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface Medicine {
  id: string;
  name: string;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  branch_id?: string;
  branch_name?: string;
}

interface OpenPackAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAdjusted: () => void;
}

export default function OpenPackAdjustmentDialog({ open, onOpenChange, medicine, onAdjusted }: OpenPackAdjustmentDialogProps) {
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  const handleOpen = () => {
    if (medicine) {
      setNewValue(String(medicine.open_pack_units || 0));
      setReason('');
    }
  };

  const handleSave = async () => {
    if (!medicine || !reason.trim()) {
      toast({ title: 'Error', description: 'Please provide a reason for the adjustment', variant: 'destructive' });
      return;
    }

    const newUnits = parseFloat(newValue) || 0;
    if (newUnits < 0) {
      toast({ title: 'Error', description: 'Value cannot be negative', variant: 'destructive' });
      return;
    }
    if (medicine.units_per_pack && newUnits > medicine.units_per_pack) {
      toast({ title: 'Error', description: `Value cannot exceed ${medicine.units_per_pack} ${medicine.unit_label || 'units'}`, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const oldValue = medicine.open_pack_units || 0;
      // Convert back to thousandths for DB storage
      const dbValue = medicine.units_per_pack ? Math.round(newUnits * 1000) : newUnits;

      const { error } = await supabase
        .from('medicines')
        .update({ open_pack_units: dbValue })
        .eq('id', medicine.id);

      if (error) throw error;

      // Determine action type
      let actionType = 'Open Pack Units Adjusted';
      if (newUnits > oldValue) actionType = 'Open Pack Units Added';
      if (newUnits < oldValue) actionType = 'Open Pack Units Removed';

      // Log to stock_edit_history
      await (supabase as any).from('stock_edit_history').insert({
        medicine_id: medicine.id,
        branch_id: medicine.branch_id || null,
        action_type: actionType,
        field_name: 'open_pack_units',
        old_value: `${oldValue} ${medicine.unit_label || 'units'}`,
        new_value: `${newUnits} ${medicine.unit_label || 'units'}`,
        reason: reason.trim(),
        done_by: profile?.id || null,
        done_by_name: profile?.full_name || 'Unknown',
        item_name: medicine.name,
        branch_name: medicine.branch_name || null,
      });

      toast({ title: 'Success', description: 'Open pack units adjusted successfully' });
      onAdjusted();
      onOpenChange(false);
    } catch (error) {
      console.error('Error adjusting open pack units:', error);
      toast({ title: 'Error', description: 'Failed to adjust open pack units', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!medicine) return null;

  const unitLabel = medicine.unit_label || 'units';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) handleOpen(); else onOpenChange(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Open Pack Units</DialogTitle>
          <DialogDescription>
            {medicine.name} — Current: {medicine.open_pack_units || 0}/{medicine.units_per_pack || '?'} {unitLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New Value ({unitLabel})</Label>
            <Input
              type="number"
              min="0"
              max={medicine.units_per_pack || undefined}
              step="0.01"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="e.g., Damaged strips removed, Manual correction, Counting adjustment..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !reason.trim()}>
            {saving ? 'Saving...' : 'Save Adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
