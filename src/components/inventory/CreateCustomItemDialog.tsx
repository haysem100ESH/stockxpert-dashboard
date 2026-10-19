import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';
import MedicineCodeCombobox from './MedicineCodeCombobox';

interface CreateCustomItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemCreated: (item: { id: string; name: string; generic_name?: string; category: string; manufacturer?: string; item_type?: string; unit_label?: string; units_per_pack?: number; minimum_stock_level?: number }) => void;
}

export default function CreateCustomItemDialog({ open, onOpenChange, onItemCreated }: CreateCustomItemDialogProps) {
  const [name, setName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [strength, setStrength] = useState('');
  const [medicineCodeId, setMedicineCodeId] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [itemType, setItemType] = useState<'full_pcs' | 'measurable'>('full_pcs');
  const [unitLabel, setUnitLabel] = useState('');
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [unitsPack, setUnitsPack] = useState('');

  // Multi-level packaging (unit -> strip -> pack only; no sub-unit level)
  const [containerType, setContainerType] = useState(''); // packaging_mode column: Pack, Bottle, Box, Carton...
  const [mainUnitName, setMainUnitName] = useState('');
  const [unitName, setUnitName] = useState(''); // strip-level label (informational; persisted via unit_label too)
  const [submitting, setSubmitting] = useState(false);

  const { toast } = useToast();
  const { profile } = useAuth();
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const { categories } = useCustomCategories(isPharmacy ? 'pharmacy' : 'general');

  const resetForm = () => {
    setName('');
    setGenericName('');
    setStrength('');
    setMedicineCodeId(null);
    setCategory('');
    setCustomCategory('');
    setManufacturer('');
    setItemType('full_pcs');
    setUnitLabel('');
    setPackagingMode('no_strip');
    setStripsPerPack('');
    setUnitsPerStrip('');
    setUnitsPack('');

    setContainerType('');
    setMainUnitName('');
    setUnitName('');
  };

  const handleCreate = async () => {
    const isNewCategory = category === '__custom__';
    const finalCategory = (isNewCategory ? customCategory.trim() : category) || 'Uncategorized';
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Item name is required', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      let ownerId = profile?.id;

      // If staff, resolve owner via branch
      if (profile?.role === 'staff' && profile?.branch_id) {
        const { data: branch } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .single();
        ownerId = branch?.pharmacy_owner_id || undefined;
      }

      // Persist a brand-new category to custom_categories so it shows up in the
      // Categories management UI and other dropdowns.
      if (isNewCategory && customCategory.trim() && ownerId) {
        const exists = categories.some(c => c.toLowerCase() === customCategory.trim().toLowerCase());
        if (!exists) {
          const { error: catErr } = await supabase.from('custom_categories').insert({
            owner_id: ownerId,
            name: customCategory.trim(),
            system_type: isPharmacy ? 'pharmacy' : 'general',
          });
          // Ignore duplicate-key errors silently; surface other failures.
          if (catErr && !String(catErr.message || '').toLowerCase().includes('duplicate')) {
            console.warn('Failed to register custom category:', catErr);
          } else {
            window.dispatchEvent(new Event('categories-updated'));
          }
        }
      }

      // Compute units_per_pack: if "with strip" → strips × units/strip, else manual input
      let computedUnitsPerPack: number | null = null;
      if (itemType === 'full_pcs' && packagingMode === 'with_strip') {
        const sp = parseInt(stripsPerPack);
        const ups = parseInt(unitsPerStrip);
        if (sp > 0 && ups > 0) {
          computedUnitsPerPack = sp * ups;
        }
      } else if (unitsPack) {
        computedUnitsPerPack = parseInt(unitsPack);
      }

      // Insert into medicines table
      // Note: purchase_price / selling_price / stock_quantity are placeholders (0).
      // Real pricing & stock are configured per-branch in Add Medicine → branch_items + inventory_batches.
      const insertPayload: any = {
        name: name.trim(),
        generic_name: genericName.trim() || null,
        category: finalCategory,
        manufacturer: manufacturer.trim() || null,
        item_type: itemType,
        unit_label: itemType === 'measurable' ? unitLabel : (unitName.trim() || 'unit'),
        units_per_pack: computedUnitsPerPack,
        minimum_stock_level: 0,
        purchase_price: 0,
        selling_price: 0,
        stock_quantity: 0,
      };

      // Pharmacy-only fields
      if (isPharmacy) {
        insertPayload.strength = strength.trim() || null;
        if (medicineCodeId) insertPayload.medicine_code_id = medicineCodeId;
      }

      // Persist strip breakdown when applicable
      if (itemType === 'full_pcs' && packagingMode === 'with_strip') {
        insertPayload.strips_per_pack = parseInt(stripsPerPack);
        insertPayload.units_per_strip = parseInt(unitsPerStrip);
      }

      // Container type & main-unit label (optional)
      if (containerType.trim()) insertPayload.packaging_mode = containerType.trim();
      if (mainUnitName.trim()) insertPayload.main_unit_name = mainUnitName.trim();

      const { data: newMed, error } = await supabase.from('medicines').insert(insertPayload).select('id, name, generic_name, category, manufacturer, item_type, unit_label, units_per_pack, minimum_stock_level').single();

      if (error) throw error;

      // Create medicine_packaging row so sales/inventory can compute strip/pack
      // prices from the LPI/unit price. Skip for measurable items.
      if (itemType === 'full_pcs') {
        const ups = parseInt(unitsPerStrip);
        const spp = parseInt(stripsPerPack);
        const hasStrip = packagingMode === 'with_strip' && ups > 0;
        const hasPack = hasStrip && spp > 0;
        try {
          await (supabase as any).from('medicine_packaging').upsert({
            medicine_id: newMed.id,
            unit_name: unitName.trim() || 'unit',
            strip_enabled: hasStrip,
            units_per_strip: hasStrip ? ups : null,
            strip_name: hasStrip ? 'strip' : null,
            pack_enabled: hasPack,
            strips_per_pack: hasPack ? spp : null,
            pack_name: hasPack ? (containerType.trim() || 'pack') : null,
            unit_selling_price: null,
            strip_selling_price: null,
            pack_selling_price: null,
          }, { onConflict: 'medicine_id' });
        } catch (e) {
          console.warn('Failed to create medicine_packaging row', e);
        }
      }

      // Auto-link to owner's first group (or create one)
      if (ownerId) {
        const { data: ownerGroups } = await supabase
          .from('owner_item_groups')
          .select('group_id')
          .eq('owner_id', ownerId)
          .limit(1);

        let groupId: string;

        if (ownerGroups && ownerGroups.length > 0) {
          groupId = ownerGroups[0].group_id;
        } else {
          // Create a default group for this owner
          const { data: newGroup, error: groupErr } = await supabase
            .from('grouped_items')
            .insert({ group_name: 'Custom Items', business_type: branchType === 'pharmacy' ? 'pharmacy' : 'general' })
            .select('id')
            .single();

          if (groupErr) throw groupErr;
          groupId = newGroup.id;

          await supabase.from('owner_item_groups').insert({ owner_id: ownerId, group_id: groupId });
        }

        // Add medicine to group
        await supabase.from('grouped_item_members').insert({ group_id: groupId, medicine_id: newMed.id });
      }

      toast({ title: 'Success', description: `"${newMed.name}" created and added to your catalog` });
      onItemCreated(newMed);
      resetForm();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating custom item:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create item', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Custom Item
          </DialogTitle>
          <DialogDescription>
            Add a new item to the catalog. It will be available in your inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Item Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Paracetamol 500mg" />
          </div>

          <div className="space-y-2">
            <Label>Generic Name</Label>
            <Input value={genericName} onChange={e => setGenericName(e.target.value)} placeholder="e.g. Acetaminophen" />
          </div>

          {isPharmacy && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strength</Label>
                  <Input value={strength} onChange={e => setStrength(e.target.value)} placeholder="e.g. 500mg, 250mg/5ml" />
                </div>
                <div className="space-y-2">
                  <MedicineCodeCombobox value={medicineCodeId} onChange={setMedicineCodeId} />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                <SelectItem value="__custom__">+ Custom Category</SelectItem>
              </SelectContent>
            </Select>
            {category === '__custom__' && (
              <Input value={customCategory} onChange={e => setCustomCategory(e.target.value)} placeholder="Enter custom category name" className="mt-2" />
            )}
          </div>

          <div className="space-y-2">
            <Label>Manufacturer</Label>
            <Input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. GSK" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Item Type</Label>
              <Select value={itemType} onValueChange={val => setItemType(val as 'full_pcs' | 'measurable')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_pcs">Countable (Pieces)</SelectItem>
                  <SelectItem value="measurable">Measurable (Kg, L, etc.)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {itemType === 'measurable' && (
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={unitLabel} onValueChange={setUnitLabel}>
                  <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {MEASURABLE_UNIT_OPTIONS.map(u => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="pt-2 border-t">
            <h3 className="text-sm font-semibold mb-1">Pricing & Stock</h3>
            <p className="text-xs text-muted-foreground mb-3">Configure packaging here. Prices and stock quantities are set per-branch when adding the item.</p>
          </div>

          {/* Strip packaging — only for countable items */}
          {itemType === 'full_pcs' && (
            <div className="space-y-2">
              <Label>Packaging</Label>
              <Select value={packagingMode} onValueChange={val => setPackagingMode(val as 'with_strip' | 'no_strip')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_strip">No strip (loose pieces)</SelectItem>
                  <SelectItem value="with_strip">With strip (e.g. tablets in blister)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {itemType === 'full_pcs' && packagingMode === 'with_strip' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strips per Item</Label>
                  <Input type="number" min="1" value={stripsPerPack} onChange={e => setStripsPerPack(e.target.value)} placeholder="e.g. 10" />
                </div>
                <div className="space-y-2">
                  <Label>Units per Strip</Label>
                  <Input type="number" min="1" value={unitsPerStrip} onChange={e => setUnitsPerStrip(e.target.value)} placeholder="e.g. 10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Unit Name</Label>
                <Input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="unit (e.g. tablet, capsule)" />
              </div>
              {stripsPerPack && unitsPerStrip && parseInt(stripsPerPack) > 0 && parseInt(unitsPerStrip) > 0 && (
                <div className="rounded-md bg-primary/10 border border-primary/20 px-3 py-2 -mt-2">
                  <p className="text-sm font-semibold">
                    Total stock per item: {parseInt(stripsPerPack) * parseInt(unitsPerStrip)} {unitName.trim() || 'unit'}{parseInt(stripsPerPack) * parseInt(unitsPerStrip) === 1 ? '' : 's'}
                  </p>
                </div>
              )}
            </>
          )}
          {itemType === 'measurable' && (
            <div className="space-y-2">
              <Label>Total stock per item</Label>
              <Input type="number" min="1" value={unitsPack} onChange={e => setUnitsPack(e.target.value)} placeholder="e.g. 10" />
            </div>
          )}

          {/* Container / packaging type (free-text with suggestions) */}
          <div className="space-y-2">
            <Label>Container Type</Label>
            <Input
              list="container-types"
              value={containerType}
              onChange={e => setContainerType(e.target.value)}
              placeholder="e.g. Pack, Bottle, Box, Carton, Sachet, Tube, Roll, Bag"
            />
            <datalist id="container-types">
              {['Pack','Bottle','Box','Carton','Sachet','Tube','Roll','Bag','Container','Vial','Ampoule'].map(o => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>

          <Button onClick={handleCreate} disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
