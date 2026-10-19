import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useMedicineGroups } from '@/hooks/useMedicineGroups';
import { useQuery } from '@tanstack/react-query';
import { createBatch, deductFIFO, getFIFOBatches, syncBranchItemQuantity, type InventoryBatch } from '@/lib/batchInventory';
import { Textarea } from '@/components/ui/textarea';
import PackagingEditor from './PackagingEditor';
import BatchesEditor from './BatchesEditor';
import {
  defaultPackaging,
  Packaging,
  autoStripPrice,
  autoPackPrice,
  formatStock,
  packagingSummary,
} from '@/lib/packaging';
import { logFieldChanges } from '@/lib/activityLog';

export interface BranchItem {
  id: string;
  medicine_id: string;
  branch_id: string;
  owner_id: string;
  selling_price: number;
  purchase_price: number;
  quantity: number;
  expiry_date?: string | null;
  // Joined from medicines
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  item_type?: string;
  unit_label?: string;
  units_per_pack?: number;
  strips_per_pack?: number;
  units_per_strip?: number;
  medicine_group?: string | null;
  strength?: string | null;
  packaging_mode?: string | null;
  main_unit_name?: string | null;
  unit_price?: number | null;
  minimum_stock_level?: number | null;
}

interface EditBranchItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BranchItem | null;
  onItemUpdated: () => void;
}

export default function EditBranchItemDialog({ open, onOpenChange, item, onItemUpdated }: EditBranchItemDialogProps) {
  // Branch-specific fields
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Catalog fields (editable)
  const [itemName, setItemName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [category, setCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [strength, setStrength] = useState('');
  const [medicineGroup, setMedicineGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');

  // Strip packaging
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [unitsPerPack, setUnitsPerPack] = useState('');

  // Multi-level packaging (unit -> strip -> pack only)
  const [containerType, setContainerType] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  // New: branch-level controls
  const [minStockLevel, setMinStockLevel] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [branchId, setBranchId] = useState('');

  const [addQuantity, setAddQuantity] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [paymentType, setPaymentType] = useState<'paid' | 'credit'>('paid');
  const [addBatchNumber, setAddBatchNumber] = useState('');
  const [reduceQuantity, setReduceQuantity] = useState('');
  const [reduceReason, setReduceReason] = useState('');
  const [reduceBatchId, setReduceBatchId] = useState<string>('auto');
  const [availableBatches, setAvailableBatches] = useState<InventoryBatch[]>([]);

  const [loading, setLoading] = useState(false);
  const [packaging, setPackaging] = useState<Packaging>(defaultPackaging());
  const [originalPackaging, setOriginalPackaging] = useState<Packaging | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const { categories: customCategories } = useCustomCategories(branchType === 'general' ? 'general' : 'pharmacy');
  const { groups: medicineGroups, addGroup } = useMedicineGroups();

  const isOwner = profile?.role === 'owner' || profile?.role === 'developer';

  const { data: branches = [] } = useQuery({
    queryKey: ['edit-item-branches', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile!.id)
        .order('name');
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!profile && isOwner && open,
    staleTime: 1000 * 60 * 5,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['edit-item-suppliers'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id, name').order('name');
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: open,
    staleTime: 1000 * 60 * 5,
  });

  // Build dropdown list: include current value if not in custom list so user never loses the existing category
  const categoryOptions = (() => {
    const set = new Set<string>(customCategories);
    if (category && category.trim()) set.add(category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  })();

  // Original units-per-pack used to convert stored pack-level prices into LPI for display
  const originalUpp = Math.max(1, Number(item?.units_per_pack || 1));

  useEffect(() => {
    if (item && open) {
      // selling_price / purchase_price are stored as LPI (per smallest unit) — show as-is.
      setSellingPrice(Number(item.selling_price).toString());
      setPurchasePrice(Number(item.purchase_price).toString());
      setExpiryDate(item.expiry_date || '');
      setItemName(item.name || '');
      setGenericName(item.generic_name || '');
      setCategory(item.category || '');
      setManufacturer(item.manufacturer || '');
      setBatchNumber(item.batch_number || '');
      setUnitLabel(item.unit_label || '');
      setStrength(item.strength || '');
      setMedicineGroup(item.medicine_group || '');
      setCustomGroup('');

      const hasStrip = !!(item.strips_per_pack && item.units_per_strip);
      setPackagingMode(hasStrip ? 'with_strip' : 'no_strip');
      setStripsPerPack(hasStrip ? String(item.strips_per_pack) : '');
      setUnitsPerStrip(hasStrip ? String(item.units_per_strip) : '');
      setUnitsPerPack(item.units_per_pack ? String(item.units_per_pack) : '');

      setContainerType(item.packaging_mode || '');
      setUnitPrice(item.unit_price != null ? String(item.unit_price) : '');

      setMinStockLevel((item as any).minimum_stock_level != null ? String((item as any).minimum_stock_level) : '');
      setLeadTimeDays((item as any).lead_time_days != null ? String((item as any).lead_time_days) : '3');
      setBranchId(item.branch_id || '');

      setAddQuantity('');
      setSelectedSupplierId('');
      setPaymentType('paid');
      setAddBatchNumber('');
      setReduceQuantity('');
      setReduceReason('');
      setReduceBatchId('auto');
      // Load packaging row (new model) or build fallback from legacy fields
      (async () => {
        const { data: pack } = await (supabase as any)
          .from('medicine_packaging')
          .select('*')
          .eq('medicine_id', item.medicine_id)
          .maybeSingle();
        let resolved: Packaging;
        if (pack) {
          resolved = pack as Packaging;
        } else {
          const fallback = defaultPackaging();
          fallback.unit_name = item.unit_label || 'unit';
          if (hasStrip) {
            fallback.strip_enabled = true;
            fallback.units_per_strip = item.units_per_strip!;
            fallback.strip_name = 'strip';
            if ((item.strips_per_pack ?? 0) > 1) {
              fallback.pack_enabled = true;
              fallback.strips_per_pack = item.strips_per_pack!;
              fallback.pack_name = 'pack';
            }
          }
          resolved = fallback;
        }
        setPackaging(resolved);
        setOriginalPackaging(JSON.parse(JSON.stringify(resolved)));
      })();
      // Load batches for FIFO/specific selection
      getFIFOBatches(item.id).then(setAvailableBatches).catch(() => setAvailableBatches([]));
    }
  }, [item, open]);

  const computeUnitsPerPack = (): number | null => {
    if (packagingMode === 'with_strip') {
      const sp = parseInt(stripsPerPack);
      const ups = parseInt(unitsPerStrip);
      if (sp > 0 && ups > 0) return sp * ups;
      return null;
    }
    return unitsPerPack ? parseInt(unitsPerPack) : null;
  };

  const catalogFieldsChanged = () => {
    if (!item) return false;
    const newUpp = computeUnitsPerPack();
    const oldStripsPerPack = item.strips_per_pack || null;
    const oldUnitsPerStrip = item.units_per_strip || null;
    const newStripsPerPack = packagingMode === 'with_strip' && stripsPerPack ? parseInt(stripsPerPack) : null;
    const newUnitsPerStrip = packagingMode === 'with_strip' && unitsPerStrip ? parseInt(unitsPerStrip) : null;
    const oldGroup = item.medicine_group || '';
    const newGroup = medicineGroup === '__custom__' ? customGroup.trim() : (medicineGroup || '');
    return (
      itemName !== (item.name || '') ||
      genericName !== (item.generic_name || '') ||
      category !== (item.category || '') ||
      manufacturer !== (item.manufacturer || '') ||
      batchNumber !== (item.batch_number || '') ||
      unitLabel !== (item.unit_label || '') ||
      newUpp !== (item.units_per_pack || null) ||
      newStripsPerPack !== oldStripsPerPack ||
      newUnitsPerStrip !== oldUnitsPerStrip ||
      containerType !== (item.packaging_mode || '') ||
      (unitPrice ? parseFloat(unitPrice) : null) !== (item.unit_price ?? null) ||
      (isPharmacy && (
        strength !== (item.strength || '') ||
        newGroup !== oldGroup
      ))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    if (packagingMode === 'with_strip') {
      const sp = parseInt(stripsPerPack);
      const ups = parseInt(unitsPerStrip);
      if (!sp || !ups || sp < 1 || ups < 1) {
        toast({ title: 'Error', description: 'Strips per item and total items are required for strip packaging', variant: 'destructive' });
        return;
      }
    }

    const reduceQty = reduceQuantity ? parseInt(reduceQuantity, 10) : 0;
    if (reduceQuantity && (!Number.isInteger(Number(reduceQuantity)) || Number(reduceQuantity) < 1)) {
      toast({ title: 'Error', description: 'Reduce quantity must be a whole number (1 or greater).', variant: 'destructive' });
      return;
    }
    if (reduceQty > 0) {
      if (!reduceReason.trim()) {
        toast({ title: 'Error', description: 'Reason is required to reduce stock.', variant: 'destructive' });
        return;
      }
      if (reduceQty > Number(item.quantity)) {
        toast({ title: 'Error', description: 'Cannot reduce more than current stock.', variant: 'destructive' });
        return;
      }
      if (reduceBatchId !== 'auto') {
        const b = availableBatches.find(x => x.id === reduceBatchId);
        if (!b) {
          toast({ title: 'Error', description: 'Selected batch not found.', variant: 'destructive' });
          return;
        }
        if (reduceQty > Number(b.remaining_quantity)) {
          toast({ title: 'Error', description: `Selected batch only has ${b.remaining_quantity} units remaining.`, variant: 'destructive' });
          return;
        }
      }
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Prices are stored as LPI (per smallest unit) — no pack-level conversion.
      const lpiSell = parseFloat(sellingPrice);
      const lpiBuy = parseFloat(purchasePrice);
      const storedSell = lpiSell;
      const storedBuy = lpiBuy;

      // Always update branch-specific fields
      const branchUpdate: any = {
        selling_price: storedSell,
        purchase_price: storedBuy,
        expiry_date: expiryDate || null,
        updated_at: new Date().toISOString(),
      };
      if (isOwner && branchId && branchId !== item.branch_id) {
        branchUpdate.branch_id = branchId;
      }

      // If catalog fields changed, we need clone-on-write
      if (catalogFieldsChanged()) {
        // Resolve final group name (pharmacy only)
        let resolvedGroup: string | null = null;
        if (isPharmacy) {
          if (medicineGroup === '__custom__') {
            const cg = customGroup.trim();
            if (cg) {
              await addGroup(cg);
              resolvedGroup = cg;
            }
          } else if (medicineGroup) {
            resolvedGroup = medicineGroup;
          }
        }

        const newMedicineData: any = {
          name: itemName.trim(),
          generic_name: genericName.trim() || null,
          category: category.trim(),
          manufacturer: manufacturer.trim() || null,
          batch_number: batchNumber.trim() || null,
          unit_label: unitLabel.trim() || null,
          units_per_pack: computeUnitsPerPack(),
          strips_per_pack: packagingMode === 'with_strip' ? parseInt(stripsPerPack) : null,
          units_per_strip: packagingMode === 'with_strip' ? parseInt(unitsPerStrip) : null,
          packaging_mode: containerType.trim() || null,
          unit_price: unitPrice && !isNaN(parseFloat(unitPrice)) ? parseFloat(unitPrice) : null,
        };
        if (isPharmacy) {
          newMedicineData.strength = strength.trim() || null;
          newMedicineData.medicine_group = resolvedGroup;
        }

        // Check if other owners also reference this medicine
        const { data: otherBranchItems } = await supabase
          .from('branch_items')
          .select('id, owner_id')
          .eq('medicine_id', item.medicine_id)
          .neq('owner_id', item.owner_id);

        const isShared = (otherBranchItems || []).length > 0;

        if (isShared) {
          // Clone: create a new medicine row for this owner
          // First get full original medicine data
          const { data: origMed } = await supabase
            .from('medicines')
            .select('*')
            .eq('id', item.medicine_id)
            .single();

          if (!origMed) throw new Error('Original medicine not found');

          // Create cloned medicine with updated fields
          const { id: _id, created_at: _ca, ...restMed } = origMed;
          const { data: clonedMed, error: cloneErr } = await supabase
            .from('medicines')
            .insert({ ...restMed, ...newMedicineData })
            .select('id')
            .single();

          if (cloneErr) throw cloneErr;

          const newMedicineId = clonedMed.id;

          // Update all this owner's branch_items that reference the old medicine to point to the clone
          await supabase
            .from('branch_items')
            .update({ medicine_id: newMedicineId })
            .eq('medicine_id', item.medicine_id)
            .eq('owner_id', item.owner_id);

          // Update inventory_batches for this owner's branch_items
          // Get this owner's branch_item IDs for the old medicine
          const { data: ownerItems } = await supabase
            .from('branch_items')
            .select('id')
            .eq('medicine_id', newMedicineId)
            .eq('owner_id', item.owner_id);

          // Update grouped_items: add clone to owner's groups, remove old
          const ownerId = item.owner_id;
          const { data: ownerGroups } = await supabase
            .from('owner_item_groups')
            .select('group_id')
            .eq('owner_id', ownerId);

          if (ownerGroups && ownerGroups.length > 0) {
            const groupIds = ownerGroups.map((g: any) => g.group_id);

            // Find which groups had the old medicine
            const { data: oldGroupedItems } = await supabase
              .from('grouped_items')
              .select('id, group_id')
              .eq('medicine_id', item.medicine_id)
              .in('group_id', groupIds);

            if (oldGroupedItems && oldGroupedItems.length > 0) {
              // Add clone to same groups
              for (const gi of oldGroupedItems) {
                await supabase
                  .from('grouped_items')
                  .insert({ group_id: gi.group_id, medicine_id: newMedicineId });
              }
              // Remove old medicine from owner's groups
              const oldIds = oldGroupedItems.map((gi: any) => gi.id);
              await supabase
                .from('grouped_items')
                .delete()
                .in('id', oldIds);
            }
          }
        } else {
          // Not shared - safe to edit the medicine directly
          const { error: medErr } = await supabase
            .from('medicines')
            .update(newMedicineData)
            .eq('id', item.medicine_id);

          if (medErr) throw medErr;
        }
      }

      // Update branch item pricing/expiry
      const { error } = await supabase
        .from('branch_items')
        .update(branchUpdate)
        .eq('id', item.id);

      if (error) throw error;

      // Upsert medicine_packaging for whichever medicine_id the branch_item now points to.
      try {
        const { data: bi } = await supabase
          .from('branch_items')
          .select('medicine_id')
          .eq('id', item.id)
          .single();
        const targetMedId = (bi as any)?.medicine_id || item.medicine_id;
        // Always recompute strip/pack from the just-entered LPI so stale prices
        // (e.g. from CSV import or previous edits) can never linger.
        const pkgForCalc: Packaging = {
          ...packaging,
          unit_selling_price: lpiSell,
          strip_selling_price: null,
          pack_selling_price: null,
        };
        const stripPrice = autoStripPrice(pkgForCalc);
        const packPrice = autoPackPrice({ ...pkgForCalc, strip_selling_price: stripPrice ?? null });
        await (supabase as any).from('medicine_packaging').upsert({
          medicine_id: targetMedId,
          unit_name: packaging.unit_name || 'unit',
          strip_enabled: packaging.strip_enabled,
          units_per_strip: packaging.strip_enabled ? packaging.units_per_strip : null,
          strip_name: packaging.strip_enabled ? (packaging.strip_name || 'strip') : null,
          pack_enabled: packaging.pack_enabled,
          strips_per_pack: packaging.pack_enabled ? packaging.strips_per_pack : null,
          pack_name: packaging.pack_enabled ? (packaging.pack_name || 'pack') : null,
          unit_selling_price: lpiSell,
          strip_selling_price: stripPrice ?? null,
          pack_selling_price: packPrice ?? null,
        }, { onConflict: 'medicine_id' });
      } catch (e) {
        console.warn('Failed to upsert medicine_packaging', e);
      }


      // Update master medicine's minimum_stock_level if changed
      if (minStockLevel !== '') {
        const newMin = parseInt(minStockLevel);
        if (!isNaN(newMin) && newMin !== ((item as any).minimum_stock_level ?? null)) {
          await supabase.from('medicines').update({ minimum_stock_level: newMin }).eq('id', item.medicine_id);
        }
      }

      // Update master medicine's lead_time_days if changed
      if (leadTimeDays !== '') {
        const newLT = parseInt(leadTimeDays);
        if (!isNaN(newLT) && newLT >= 0 && newLT !== ((item as any).lead_time_days ?? 3)) {
          await (supabase as any).from('medicines').update({ lead_time_days: newLT }).eq('id', item.medicine_id);
        }
      }


      // If user entered an "add stock" quantity, create a new batch (+ optional supplier purchase)
      const addQty = addQuantity ? parseFloat(addQuantity) : 0;
      if (addQty > 0) {
        const targetBranchId = (isOwner && branchId) ? branchId : item.branch_id;
        const pp = storedBuy;
        const sp = storedSell;

        const { error: batchErr } = await createBatch({
          branchId: targetBranchId,
          medicineId: item.medicine_id,
          branchItemId: item.id,
          supplierId: selectedSupplierId || null,
          batchNumber: addBatchNumber || null,
          quantity: addQty,
          purchasePrice: pp,
          sellingPrice: sp,
          expiryDate: expiryDate || null,
          createdBy: user?.id || null,
        });
        if (batchErr) throw batchErr;

        if (selectedSupplierId) {
          const totalAmount = addQty * pp;
          await supabase.from('supplier_purchases').insert({
            supplier_id: selectedSupplierId,
            item_name: itemName || item.name,
            quantity: addQty,
            unit_cost: pp,
            total_cost: totalAmount,
            payment_type: paymentType,
            branch_id: targetBranchId,
            created_by: user?.id || null,
          });

          if (paymentType === 'credit') {
            const { data: existingDebt } = await supabase
              .from('supplier_debts')
              .select('id, total_debt')
              .eq('supplier_id', selectedSupplierId)
              .maybeSingle();
            if (existingDebt) {
              await supabase.from('supplier_debts').update({ total_debt: existingDebt.total_debt + totalAmount }).eq('id', existingDebt.id);
            } else {
              await supabase.from('supplier_debts').insert({ supplier_id: selectedSupplierId, total_debt: totalAmount });
            }
          }
        }
      }

      // Reduce stock with required reason
      if (reduceQty > 0) {
        const targetBranchId = (isOwner && branchId) ? branchId : item.branch_id;
        if (reduceBatchId !== 'auto') {
          // Deduct from a specific batch
          const b = availableBatches.find(x => x.id === reduceBatchId);
          if (b) {
            const newRem = Math.max(0, Number(b.remaining_quantity) - reduceQty);
            const { error: bErr } = await supabase
              .from('inventory_batches')
              .update({ remaining_quantity: newRem, updated_at: new Date().toISOString() })
              .eq('id', b.id);
            if (bErr) {
              const newStock = Math.max(0, Number(item.quantity) - reduceQty);
              await supabase.from('branch_items').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', item.id);
            } else {
              await syncBranchItemQuantity(item.id);
            }
          }
        } else {
          const { error: fifoErr } = await deductFIFO(item.id, reduceQty);
          if (fifoErr) {
            const newStock = Math.max(0, Number(item.quantity) - reduceQty);
            await supabase.from('branch_items').update({ quantity: newStock, updated_at: new Date().toISOString() }).eq('id', item.id);
          }
        }

        // Audit logs
        try {
          await supabase.from('inventory_stock_adjustments').insert({
            medicine_id: item.medicine_id,
            branch_id: targetBranchId,
            adjustment_type: 'decrease',
            quantity: reduceQty,
            reason: reduceReason.trim(),
            deduct_from_expense: false,
            created_by: user?.id || null,
          });
        } catch (e) { console.warn('adjustment log failed', e); }

        try {
          const oldStock = Number(item.quantity);
          const newStock = Math.max(0, oldStock - reduceQty);
          await (supabase as any).from('stock_edit_history').insert({
            medicine_id: item.medicine_id,
            branch_id: targetBranchId || null,
            action_type: 'Stock Decreased',
            field_name: 'stock_quantity',
            old_value: String(oldStock),
            new_value: String(newStock),
            reason: reduceReason.trim(),
            done_by: profile?.id || null,
            done_by_name: profile?.full_name || 'Unknown',
            item_name: item.name,
          });
        } catch (e) { console.warn('history log failed', e); }
      }


      try {
        const changes: Array<{ field: string; oldVal: any; newVal: any }> = [];
        if (storedSell !== Number(item.selling_price)) {
          changes.push({ field: 'selling_price', oldVal: item.selling_price, newVal: storedSell });
        }
        if (storedBuy !== Number(item.purchase_price)) {
          changes.push({ field: 'purchase_price', oldVal: item.purchase_price, newVal: storedBuy });
        }
        if ((expiryDate || null) !== (item.expiry_date || null)) {
          changes.push({ field: 'expiry_date', oldVal: item.expiry_date || '—', newVal: expiryDate || '—' });
        }
        if (itemName !== (item.name || '')) changes.push({ field: 'name', oldVal: item.name, newVal: itemName });
        if (genericName !== (item.generic_name || '')) changes.push({ field: 'generic_name', oldVal: item.generic_name || '—', newVal: genericName || '—' });
        if (category !== (item.category || '')) changes.push({ field: 'category', oldVal: item.category, newVal: category });
        if (manufacturer !== (item.manufacturer || '')) changes.push({ field: 'manufacturer', oldVal: item.manufacturer || '—', newVal: manufacturer || '—' });
        if (batchNumber !== (item.batch_number || '')) changes.push({ field: 'batch_number', oldVal: item.batch_number || '—', newVal: batchNumber || '—' });
        if (unitLabel !== (item.unit_label || '')) changes.push({ field: 'unit_label', oldVal: item.unit_label || '—', newVal: unitLabel || '—' });

        if (changes.length > 0) {
          const rows = changes.map(c => ({
            medicine_id: item.medicine_id,
            branch_id: item.branch_id || null,
            action_type: 'Item Modified',
            field_name: c.field,
            old_value: String(c.oldVal ?? ''),
            new_value: String(c.newVal ?? ''),
            reason: 'Edited via Edit Item dialog',
            done_by: profile?.id || null,
            done_by_name: profile?.full_name || 'Unknown',
            item_name: itemName || item.name,
          }));
          await (supabase as any).from('stock_edit_history').insert(rows);
        }
      } catch (logErr) {
        console.warn('Failed to log edit history:', logErr);
      }

      // Activity Center: log every changed field across Pricing & Stock + Item Info tabs.
      try {
        const oldLpiSell = Number(item.selling_price);
        const oldLpiBuy = Number(item.purchase_price);
        const oldGroup = item.medicine_group || '';
        const newGroup = medicineGroup === '__custom__' ? customGroup.trim() : (medicineGroup || '');
        const itemMeta = { item_name: itemName || item.name, entity_name: itemName || item.name };
        const round4 = (n: number) => Number.isFinite(n) ? Number(n.toFixed(4)) : n;

        await logFieldChanges('edit_item', {
          // Pricing & Stock tab
          'LPI Sell Price':         [round4(oldLpiSell), round4(lpiSell)],
          'LPI Buy Price':          [round4(oldLpiBuy), round4(lpiBuy)],
          'Minimum Stock Level':    [(item as any).minimum_stock_level ?? null, minStockLevel === '' ? null : parseInt(minStockLevel)],
          'Lead Time (days)':       [(item as any).lead_time_days ?? null, leadTimeDays === '' ? null : parseInt(leadTimeDays)],
          'Branch':                 [item.branch_id, branchId || item.branch_id],
          'Container Type':         [item.packaging_mode || null, containerType || null],
          // Item Info tab
          'Item Name':              [item.name, itemName],
          'Generic Name':           [item.generic_name, genericName],
          'Strength':               [item.strength, strength],
          'Medicine Group':         [oldGroup, newGroup],
          'Category':               [item.category, category],
          'Manufacturer / Brand':   [item.manufacturer, manufacturer],
          'Batch Number':           [item.batch_number, batchNumber],
          'Unit Label':             [item.unit_label, unitLabel],
        }, { entityType: 'branch_item', entityId: item.id, metadata: itemMeta });

        // Packaging (Pricing & Stock tab — strip / pack settings)
        if (originalPackaging) {
          await logFieldChanges('edit_item', {
            'Unit Name':                    [originalPackaging.unit_name, packaging.unit_name],
            'Has Strip / Blister':          [originalPackaging.strip_enabled, packaging.strip_enabled],
            'Strip Name':                   [originalPackaging.strip_name, packaging.strip_name],
            'Units Per Strip':              [originalPackaging.units_per_strip, packaging.units_per_strip],
            'Has Pack / Box':               [originalPackaging.pack_enabled, packaging.pack_enabled],
            'Pack Name':                    [originalPackaging.pack_name, packaging.pack_name],
            'Strips Per Pack':              [originalPackaging.strips_per_pack, packaging.strips_per_pack],
          }, { entityType: 'branch_item', entityId: item.id, metadata: itemMeta });
        }
      } catch (e) {
        console.warn('Activity log (edit item) failed', e);
      }

      toast({ title: 'Success', description: 'Item updated successfully' });
      window.dispatchEvent(new Event('app:refresh'));
      onItemUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to update item', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
          <DialogDescription>
            Update item details. Changes to item info won't affect other users' items.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs defaultValue="branch" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="branch">Packaging & Config</TabsTrigger>
              <TabsTrigger value="batches">Batches</TabsTrigger>
              <TabsTrigger value="catalog">Item Info</TabsTrigger>
            </TabsList>

            <TabsContent value="batches" className="space-y-4 mt-4">
              <BatchesEditor
                branchId={item.branch_id}
                medicineId={item.medicine_id}
                branchItemId={item.id}
                defaultPurchasePrice={Number(item.purchase_price) || 0}
                defaultSellingPrice={Number(item.selling_price) || 0}
                onChanged={() => { onItemUpdated(); }}
              />
            </TabsContent>

            <TabsContent value="branch" className="space-y-4 mt-4">
              {/* Read-only stock info — total never changes when packaging is reconfigured */}
              <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                <p className="font-semibold">{item.name}</p>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{item.category}</Badge>
                  {item.item_type && <Badge variant="secondary">{item.item_type}</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  Current Stock:{' '}
                  <span className="font-medium text-foreground">
                    {formatStock(Number(item.quantity || 0), packaging)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Total: {Number(item.quantity || 0)} {packaging.unit_name || item.unit_label || 'unit'}{Number(item.quantity || 0) === 1 ? '' : 's'} · {packagingSummary(packaging)}
                </div>
                <p className="text-[11px] text-muted-foreground italic">
                  Changing strip / pack settings only regroups the breakdown — the total stays the same. Use "Adjust Stock" to change it.
                </p>
              </div>


              {/* Prices are managed per-batch in the Batches tab. */}
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                Prices are now configured <span className="font-semibold text-foreground">per batch</span>. Open the
                <span className="font-semibold text-foreground"> Batches </span> tab to set buy/sell prices for each batch of this item.
              </div>


              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Minimum Stock Level (alert!)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={minStockLevel}
                    onChange={e => setMinStockLevel(e.target.value)}
                    placeholder="e.g. 10"
                  />
                  <p className="text-xs text-muted-foreground">Triggers low-stock alerts when quantity drops below this.</p>
                </div>
                <div className="space-y-2">
                  <Label>Lead Time (days)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={leadTimeDays}
                    onChange={e => setLeadTimeDays(e.target.value)}
                    placeholder="3"
                    title="How many days does it typically take for this item to arrive after ordering?"
                  />
                  <p className="text-xs text-muted-foreground">How many days does this item typically take to arrive after ordering? Used to compute the reorder point.</p>
                </div>
              </div>


              {isOwner && branches.length > 0 && (
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Packaging — new Unit / Strip / Pack model */}
              <PackagingEditor
                value={packaging}
                hidePrices
                onChange={(next) => {
                  setPackaging(next);
                  // Mirror into legacy state so the existing save path stays in sync.
                  if (next.strip_enabled && next.units_per_strip) {
                    setPackagingMode('with_strip');
                    setUnitsPerStrip(String(next.units_per_strip));
                    if (next.pack_enabled && next.strips_per_pack) {
                      setStripsPerPack(String(next.strips_per_pack));
                      setUnitsPerPack(String(next.strips_per_pack * next.units_per_strip));
                    } else {
                      setStripsPerPack('');
                      setUnitsPerPack(String(next.units_per_strip));
                    }
                  } else {
                    setPackagingMode('no_strip');
                    setStripsPerPack('');
                    setUnitsPerStrip('');
                    setUnitsPerPack('');
                  }
                  if (next.unit_name) setUnitLabel(next.unit_name);
                }}
              />


              {/* Container / packaging type */}
              <div className="space-y-2">
                <Label>Container Type</Label>
                <Input
                  list="edit-container-types"
                  value={containerType}
                  onChange={e => setContainerType(e.target.value)}
                  placeholder="e.g. Pack, Bottle, Box, Carton, Sachet, Tube, Roll, Bag"
                />
                <datalist id="edit-container-types">
                  {['Pack','Bottle','Box','Carton','Sachet','Tube','Roll','Bag','Container','Vial','Ampoule'].map(o => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>

            </TabsContent>

            <TabsContent value="catalog" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Item Name *</Label>
                <Input value={itemName} onChange={e => setItemName(e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label>Generic Name</Label>
                <Input value={genericName} onChange={e => setGenericName(e.target.value)} placeholder="Optional" />
              </div>

              {isPharmacy && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Strength</Label>
                      <Input value={strength} onChange={e => setStrength(e.target.value)} placeholder="e.g. 500mg" />
                    </div>
                    <div className="space-y-2">
                      <Label>Medicine Group</Label>
                      <Select value={medicineGroup || undefined} onValueChange={setMedicineGroup}>
                        <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                        <SelectContent>
                          {(() => {
                            const names = new Set(medicineGroups.map(g => g.name));
                            if (medicineGroup && !names.has(medicineGroup) && medicineGroup !== '__custom__') names.add(medicineGroup);
                            return Array.from(names).sort().map(n => (
                              <SelectItem key={n} value={n}>{n}</SelectItem>
                            ));
                          })()}
                          <SelectItem value="__custom__">+ Custom Group</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {medicineGroup === '__custom__' && (
                    <Input value={customGroup} onChange={e => setCustomGroup(e.target.value)} placeholder="Enter new group name" />
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {categoryOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No categories yet. Create some in the Categories page.
                        </div>
                      ) : (
                        categoryOptions.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Manufacturer / Brand</Label>
                  <Input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Batch Number</Label>
                  <Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Unit Label</Label>
                  <Input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="e.g. tablets, ml" />
                </div>
              </div>

              {catalogFieldsChanged() && (
                <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  ℹ️ Item info changes are scoped to your account only and won't affect other users.
                </p>
              )}
            </TabsContent>
          </Tabs>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
