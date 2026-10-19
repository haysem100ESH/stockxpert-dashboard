import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useMedicineGroups } from '@/hooks/useMedicineGroups';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';
import MedicineCodeCombobox from './MedicineCodeCombobox';
import PackagingEditor from './PackagingEditor';
import { defaultPackaging, Packaging, autoStripPrice, autoPackPrice, formatStock, packagingSummary } from '@/lib/packaging';
import { logActivity, logFieldChanges } from '@/lib/activityLog';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  country_name?: string;
  purchase_price: number;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date?: string;
  expiry_alert_enabled?: boolean;
  medicine_group?: string | null;
  strength?: string | null;
  medicine_code_id?: string | null;
}

interface EditMedicineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onMedicineUpdated: () => void;
}

interface MedicineWithBranch extends Medicine {
  branch_id?: string;
}

export default function EditMedicineDialog({
  open,
  onOpenChange,
  medicine,
  onMedicineUpdated
}: EditMedicineDialogProps) {
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  
  const { categories: pharmacyCategories, loading: pharmLoading } = useCustomCategories('pharmacy');
  const { categories: generalCategories, loading: genLoading } = useCustomCategories('general');
  const { groups: medicineGroups, addGroup } = useMedicineGroups();
  const categoriesLoading = pharmLoading || genLoading;
  const allCategories = [...new Set([...pharmacyCategories, ...generalCategories])].sort();

  const [medicineData, setMedicineData] = useState({
    name: '',
    generic_name: '',
    category: '',
    manufacturer: '',
    batch_number: '',
    country_name: '',
    purchase_price: '',
    selling_price: '',
    stock_quantity: '',
    minimum_stock_level: '',
    units_per_pack: '',
    unit_label: 'strip',
    expiry_date: '',
    expiry_alert_enabled: true,
    branch_id: '',
    item_type: 'full_pcs' as 'full_pcs' | 'measurable',
    strength: '',
    medicine_group: '',
  });
  const [customGroup, setCustomGroup] = useState('');
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [measurableUnit, setMeasurableUnit] = useState<string>('kg');
  const [recordInExpense, setRecordInExpense] = useState(true);
  const [originalRecordInExpense, setOriginalRecordInExpense] = useState(true);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [userRole, setUserRole] = useState<'owner' | 'staff' | null>(null);
  const [loading, setLoading] = useState(false);
  const [medicineCodeId, setMedicineCodeId] = useState<string | null>(null);
  const [originalMedicineCodeId, setOriginalMedicineCodeId] = useState<string | null>(null);
  const [packaging, setPackaging] = useState<Packaging>(defaultPackaging());
  const [originalPackaging, setOriginalPackaging] = useState<Packaging | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchUserRoleAndBranches = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        setUserRole(profile.role as 'owner' | 'staff');
        if (profile.role === 'owner') {
          const { data: branchesData } = await supabase
            .from('pharmacy_branches')
            .select('id, name')
            .eq('pharmacy_owner_id', user.id)
            .order('is_main_branch', { ascending: false })
            .order('name');
          if (branchesData) setBranches(branchesData);
        }
      }
    };
    if (open) fetchUserRoleAndBranches();
  }, [open]);

  useEffect(() => {
    if (medicine && open) {
      const medicineWithBranch = medicine as MedicineWithBranch & { units_per_pack?: number; unit_label?: string; item_type?: string; strips_per_pack?: number; units_per_strip?: number };
      const unitLbl = medicineWithBranch.unit_label || 'strip';
      const isMeas = (medicineWithBranch.item_type === 'measurable') || MEASURABLE_UNIT_OPTIONS.some(o => o.value === unitLbl.toLowerCase());
      if (isMeas) {
        setMeasurableUnit(unitLbl.toLowerCase());
      }

      // Detect strip packaging from persisted columns
      const hasStripBreakdown = !!(medicineWithBranch.strips_per_pack && medicineWithBranch.units_per_strip);
      setPackagingMode(hasStripBreakdown ? 'with_strip' : 'no_strip');
      setStripsPerPack(hasStripBreakdown ? String(medicineWithBranch.strips_per_pack) : '');
      setUnitsPerStrip(hasStripBreakdown ? String(medicineWithBranch.units_per_strip) : '');

      setMedicineData({
        name: medicine.name || '',
        generic_name: medicine.generic_name || '',
        category: medicine.category || '',
        manufacturer: medicine.manufacturer || '',
        batch_number: medicine.batch_number || '',
        country_name: medicine.country_name || '',
        purchase_price: medicine.purchase_price.toString(),
        selling_price: medicine.selling_price.toString(),
        stock_quantity: medicine.stock_quantity.toString(),
        minimum_stock_level: medicine.minimum_stock_level.toString(),
        units_per_pack: medicineWithBranch.units_per_pack ? medicineWithBranch.units_per_pack.toString() : '',
        unit_label: unitLbl,
        expiry_date: medicine.expiry_date || '',
        expiry_alert_enabled: medicine.expiry_alert_enabled ?? true,
        branch_id: medicineWithBranch.branch_id || '',
        item_type: isMeas ? 'measurable' : ((medicineWithBranch.item_type as 'full_pcs' | 'measurable') || 'full_pcs'),
        strength: medicine.strength || '',
        medicine_group: medicine.medicine_group || '',
      });
      setCustomGroup('');
      setMedicineCodeId(medicine.medicine_code_id ?? null);
      setOriginalMedicineCodeId(medicine.medicine_code_id ?? null);

      // Load packaging row (or build from legacy fields as fallback)
      (async () => {
        const { data: pack } = await (supabase as any)
          .from('medicine_packaging')
          .select('*')
          .eq('medicine_id', medicine.id)
          .maybeSingle();
        let resolved: Packaging;
        if (pack) {
          resolved = pack as Packaging;
        } else {
          const fallback = defaultPackaging();
          fallback.unit_name = unitLbl || 'unit';
          if (hasStripBreakdown) {
            fallback.strip_enabled = true;
            fallback.units_per_strip = medicineWithBranch.units_per_strip!;
            fallback.strip_name = 'strip';
            if ((medicineWithBranch.strips_per_pack ?? 0) > 1) {
              fallback.pack_enabled = true;
              fallback.strips_per_pack = medicineWithBranch.strips_per_pack!;
              fallback.pack_name = 'pack';
            }
          }
          fallback.pack_selling_price = medicine.selling_price ?? null;
          resolved = fallback;
        }
        setPackaging(resolved);
        setOriginalPackaging(JSON.parse(JSON.stringify(resolved)));
      })();

      // Check if an expense exists for this item
      (async () => {
        const { data: existingExpense } = await supabase
          .from('expenses')
          .select('id')
          .ilike('description', `%Purchase of ${medicine.name}%`)
          .eq('category', 'Stock Purchase')
          .limit(1);
        const hasExpense = existingExpense && existingExpense.length > 0;
        setRecordInExpense(hasExpense);
        setOriginalRecordInExpense(hasExpense);
      })();
    }
  }, [medicine, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicine) return;
    setLoading(true);

    try {
      const isMeas = medicineData.item_type === 'measurable';
      const unitLabel = isMeas ? measurableUnit : (packaging.unit_name || 'unit');

      // Derive legacy packaging columns from the new packaging state
      let computedUnitsPerPack: number | null = null;
      let stripsPerPackVal: number | null = null;
      let unitsPerStripVal: number | null = null;
      let packagingModeVal: string | null = null;
      if (!isMeas) {
        if (packaging.strip_enabled && packaging.units_per_strip) {
          unitsPerStripVal = packaging.units_per_strip;
          packagingModeVal = 'with_strip';
          if (packaging.pack_enabled && packaging.strips_per_pack) {
            stripsPerPackVal = packaging.strips_per_pack;
            computedUnitsPerPack = packaging.strips_per_pack * packaging.units_per_strip;
          } else {
            computedUnitsPerPack = packaging.units_per_strip;
          }
        } else {
          packagingModeVal = 'no_strip';
        }
      }

      // Resolve medicine group (pharmacy mode)
      let resolvedGroup: string | null = null;
      if (isPharmacy) {
        if (medicineData.medicine_group === '__custom__') {
          const cg = customGroup.trim();
          if (cg) {
            await addGroup(cg);
            resolvedGroup = cg;
          }
        } else if (medicineData.medicine_group) {
          resolvedGroup = medicineData.medicine_group;
        }
      }

      const updateData: any = {
        name: medicineData.name,
        generic_name: medicineData.generic_name || null,
        category: medicineData.category || 'other',
        manufacturer: medicineData.manufacturer || null,
        batch_number: isPharmacy ? (medicineData.batch_number || null) : null,
        country_name: medicineData.country_name || null,
        purchase_price: parseFloat(medicineData.purchase_price),
        selling_price: parseFloat(medicineData.selling_price),
        minimum_stock_level: parseInt(medicineData.minimum_stock_level),
        units_per_pack: computedUnitsPerPack,
        unit_label: unitLabel,
        packaging_mode: packagingModeVal,
        expiry_date: isPharmacy ? (medicineData.expiry_date || null) : null,
        expiry_alert_enabled: isPharmacy ? medicineData.expiry_alert_enabled : false,
        item_type: medicineData.item_type,
        strips_per_pack: stripsPerPackVal,
        units_per_strip: unitsPerStripVal,
        // Pharmacy-only fields
        strength: isPharmacy ? (medicineData.strength.trim() || null) : null,
        medicine_group: isPharmacy ? resolvedGroup : null,
        medicine_code_id: medicineCodeId,
      };

      if (userRole === 'owner' && medicineData.branch_id) {
        updateData.branch_id = medicineData.branch_id;
      }

      const { error } = await supabase.from('medicines').update(updateData).eq('id', medicine.id);
      if (error) throw error;
      // Detailed per-field activity logging (only changed fields).
      const prev = medicine as any;
      const itemMeta = { item_name: updateData.name, entity_name: updateData.name };
      await logFieldChanges('edit_item', {
        'Item Name':           [prev.name, updateData.name],
        'Generic Name':        [prev.generic_name, updateData.generic_name],
        'Strength':            [prev.strength, updateData.strength],
        'Medicine Group':      [prev.medicine_group, updateData.medicine_group],
        'Category':            [prev.category, updateData.category],
        'Manufacturer / Brand':[prev.manufacturer, updateData.manufacturer],
        'Batch Number':        [prev.batch_number, updateData.batch_number],
        'Country':             [prev.country_name, updateData.country_name],
        'LPI Buy Price':       [Number(prev.purchase_price), Number(updateData.purchase_price)],
        'LPI Sell Price':      [Number(prev.selling_price), Number(updateData.selling_price)],
        'Minimum Stock Level': [Number(prev.minimum_stock_level), Number(updateData.minimum_stock_level)],
        'Unit Name':           [prev.unit_label, updateData.unit_label],
        'Units Per Strip':     [prev.units_per_strip, updateData.units_per_strip],
        'Strips Per Pack':     [prev.strips_per_pack, updateData.strips_per_pack],
        'Expiry Alert':        [prev.expiry_alert_enabled, updateData.expiry_alert_enabled],
      }, { entityType: 'medicine', entityId: medicine.id, metadata: itemMeta });

      // Packaging-level fields.
      if (originalPackaging) {
        await logFieldChanges('edit_item', {
          'Has Strip / Blister': [originalPackaging.strip_enabled, packaging.strip_enabled],
          'Strip Name':          [originalPackaging.strip_name, packaging.strip_name],
          'Units Per Strip (Packaging)': [originalPackaging.units_per_strip, packaging.units_per_strip],
          'Has Pack / Box':      [originalPackaging.pack_enabled, packaging.pack_enabled],
          'Pack Name':           [originalPackaging.pack_name, packaging.pack_name],
          'Strips Per Pack (Packaging)': [originalPackaging.strips_per_pack, packaging.strips_per_pack],
          'Unit Selling Price':  [originalPackaging.unit_selling_price, packaging.unit_selling_price],
          'Strip Selling Price': [originalPackaging.strip_selling_price, packaging.strip_selling_price],
          'Pack Selling Price':  [originalPackaging.pack_selling_price, packaging.pack_selling_price],
        }, { entityType: 'medicine', entityId: medicine.id, metadata: itemMeta });
      }

      // Medicine code assignment change.
      if ((originalMedicineCodeId ?? null) !== (medicineCodeId ?? null)) {
        logActivity({
          type: medicineCodeId ? 'assign_item_to_code' : 'unassign_item_from_code',
          entityType: 'medicine',
          entityId: medicine.id,
          previous: { medicine_code_id: originalMedicineCodeId },
          next: { medicine_code_id: medicineCodeId },
          metadata: {
            item_name: updateData.name,
            medicine_name: updateData.name,
            previous_code_id: originalMedicineCodeId,
            new_code_id: medicineCodeId,
          },
        });
      }


      // Upsert packaging row (Full PCS items only)
      if (!isMeas) {
        const stripPrice = packaging.strip_selling_price ?? autoStripPrice(packaging);
        const packPrice = packaging.pack_selling_price ?? autoPackPrice(packaging);
        await (supabase as any).from('medicine_packaging').upsert({
          medicine_id: medicine.id,
          unit_name: packaging.unit_name || 'unit',
          strip_enabled: packaging.strip_enabled,
          units_per_strip: packaging.strip_enabled ? packaging.units_per_strip : null,
          strip_name: packaging.strip_enabled ? (packaging.strip_name || 'strip') : null,
          pack_enabled: packaging.pack_enabled,
          strips_per_pack: packaging.pack_enabled ? packaging.strips_per_pack : null,
          pack_name: packaging.pack_enabled ? (packaging.pack_name || 'pack') : null,
          unit_selling_price: packaging.unit_selling_price ?? null,
          strip_selling_price: stripPrice ?? null,
          pack_selling_price: packPrice ?? updateData.selling_price ?? null,
        }, { onConflict: 'medicine_id' });
      }


      // Expense sync logic
      const { data: { user } } = await supabase.auth.getUser();
      if (recordInExpense && !originalRecordInExpense) {
        // Unchecked → Checked: add expense
        const stockQty = isMeas ? parseFloat(medicineData.stock_quantity) : parseInt(medicineData.stock_quantity);
        const purchasePrice = parseFloat(medicineData.purchase_price);
        if (stockQty > 0 && purchasePrice > 0) {
          const expenseAmount = stockQty * purchasePrice;
          const unit = isMeas ? measurableUnit.toUpperCase() : (medicineData.unit_label || 'pcs');
          await supabase.from('expenses').insert({
            description: `Purchase of ${medicineData.name} (${stockQty} ${unit})`,
            amount: expenseAmount,
            category: 'Stock Purchase',
            created_by: user?.id || null,
            branch_id: medicineData.branch_id || null,
          });
        }
      } else if (!recordInExpense && originalRecordInExpense) {
        // Checked → Unchecked: remove expense
        await supabase
          .from('expenses')
          .delete()
          .ilike('description', `%Purchase of ${medicine.name}%`)
          .eq('category', 'Stock Purchase');
      }

      toast({ title: "Success", description: `${isPharmacy ? 'Medicine' : 'Item'} updated successfully` });
      onMedicineUpdated();
    } catch (error) {
      toast({ title: "Error", description: `Failed to update ${isPharmacy ? 'medicine' : 'item'}`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPharmacy ? 'Edit Medicine' : 'Edit Item'}</DialogTitle>
          <DialogDescription>
            Update the {isPharmacy ? 'medicine' : 'item'} information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Item Type */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <Label className="text-sm font-semibold">Item Type</Label>
            <RadioGroup
              value={medicineData.item_type}
              onValueChange={(val) => setMedicineData({ ...medicineData, item_type: val as 'full_pcs' | 'measurable' })}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="full_pcs" id="edit_type_full_pcs" />
                <Label htmlFor="edit_type_full_pcs" className="cursor-pointer">
                  <span className="font-medium">Full PCS</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="measurable" id="edit_type_measurable" />
                <Label htmlFor="edit_type_measurable" className="cursor-pointer">
                  <span className="font-medium">Measurable</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{isPharmacy ? 'Medicine Name' : 'Item Name'} *</Label>
            <Input id="name" value={medicineData.name} onChange={(e) => setMedicineData({ ...medicineData, name: e.target.value })} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="generic_name">{isPharmacy ? 'Generic Name' : 'Description'}</Label>
            <Input id="generic_name" value={medicineData.generic_name} onChange={(e) => setMedicineData({ ...medicineData, generic_name: e.target.value })} />
          </div>

          {isPharmacy && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strength</Label>
                  <Input value={medicineData.strength} onChange={(e) => setMedicineData({ ...medicineData, strength: e.target.value })} placeholder="e.g. 500mg" />
                </div>
                <div className="space-y-2">
                  <Label>Medicine Group</Label>
                  <Select value={medicineData.medicine_group || undefined} onValueChange={(v) => setMedicineData({ ...medicineData, medicine_group: v })}>
                    <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const names = new Set(medicineGroups.map(g => g.name));
                        if (medicineData.medicine_group && !names.has(medicineData.medicine_group) && medicineData.medicine_group !== '__custom__') {
                          names.add(medicineData.medicine_group);
                        }
                        return Array.from(names).sort().map(n => (
                          <SelectItem key={n} value={n}>{n}</SelectItem>
                        ));
                      })()}
                      <SelectItem value="__custom__">+ Custom Group</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {medicineData.medicine_group === '__custom__' && (
                <Input value={customGroup} onChange={(e) => setCustomGroup(e.target.value)} placeholder="Enter new group name" />
              )}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <Select 
              key={`category-select-${medicineData.category}-${allCategories.length}`}
              value={medicineData.category || undefined} 
              onValueChange={(value: string) => setMedicineData({ ...medicineData, category: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={categoriesLoading ? "Loading categories..." : "Select category"} />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const currentCat = medicineData.category;
                  const displayList = [...allCategories];
                  if (currentCat && !displayList.includes(currentCat)) {
                    displayList.push(currentCat);
                  }
                  displayList.sort();
                  return displayList.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ')}
                    </SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manufacturer">{isPharmacy ? 'Manufacturer' : 'Brand'}</Label>
            <Input id="manufacturer" value={medicineData.manufacturer} onChange={(e) => setMedicineData({ ...medicineData, manufacturer: e.target.value })} />
          </div>

          {isPharmacy && (
            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" value={medicineData.batch_number} onChange={(e) => setMedicineData({ ...medicineData, batch_number: e.target.value })} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="country_name">Country Name</Label>
            <Input id="country_name" value={medicineData.country_name} onChange={(e) => setMedicineData({ ...medicineData, country_name: e.target.value })} />
          </div>

          {userRole === 'owner' && branches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="branch_id">Assign to Branch *</Label>
              <Select value={medicineData.branch_id} onValueChange={(value) => setMedicineData({ ...medicineData, branch_id: value })}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase_price">Purchase Price *</Label>
              <Input id="purchase_price" type="number" step="0.01" value={medicineData.purchase_price} onChange={(e) => setMedicineData({ ...medicineData, purchase_price: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price *</Label>
              <Input id="selling_price" type="number" step="0.01" value={medicineData.selling_price} onChange={(e) => setMedicineData({ ...medicineData, selling_price: e.target.value })} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minimum_stock_level">Minimum Stock Level (for alert!) *</Label>
            <Input id="minimum_stock_level" type="number" value={medicineData.minimum_stock_level} onChange={(e) => setMedicineData({ ...medicineData, minimum_stock_level: e.target.value })} required />
          </div>

          {/* Measurable unit selector */}
          {medicineData.item_type === 'measurable' && (
            <div className="space-y-2">
              <Label>Measurement Unit *</Label>
              <Select value={measurableUnit} onValueChange={setMeasurableUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEASURABLE_UNIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {medicineData.item_type === 'measurable' && (
            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stock Quantity</Label>
              <Input id="stock_quantity" type="number" value={medicineData.stock_quantity} disabled className="opacity-60 cursor-not-allowed" />
              <p className="text-xs text-muted-foreground">Use "Adjust Stock" to change quantity</p>
            </div>
          )}

          {/* Unit / Strip / Pack — only for Full PCS */}
          {medicineData.item_type === 'full_pcs' && (() => {
            const totalUnits = Number(medicineData.stock_quantity || 0);
            const unitName = packaging.unit_name || 'unit';
            return (
              <>
                <PackagingEditor value={packaging} onChange={setPackaging} />

                <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                  <Label className="text-sm font-semibold">Stock on hand</Label>
                  <div className="space-y-1">
                    <Label className="text-xs">Total {unitName}{totalUnits === 1 ? '' : 's'}</Label>
                    <Input
                      type="number"
                      value={medicineData.stock_quantity}
                      disabled
                      className="opacity-60 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    = {formatStock(totalUnits, packaging)}
                  </p>
                  <p className="text-xs text-muted-foreground">{packagingSummary(packaging)}</p>
                  <p className="text-xs text-muted-foreground">
                    Toggle Strip / Pack above and set sizes — the breakdown updates automatically.
                    Use "Adjust Stock" to change the total quantity.
                  </p>
                </div>
              </>
            );
          })()}


          {isPharmacy && (
            <>
              {/* Expiry date is captured per-batch (Batches view), not at item level */}


              <div className="space-y-2">
                <Label htmlFor="expiry_alert_enabled">Alert me before expiry</Label>
                <Select value={medicineData.expiry_alert_enabled ? "1" : "0"} onValueChange={(value) => setMedicineData({ ...medicineData, expiry_alert_enabled: value !== "0" })}>
                  <SelectTrigger><SelectValue placeholder="Select alert period" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No Alert</SelectItem>
                    <SelectItem value="1">1 Month</SelectItem>
                    <SelectItem value="2">2 Months</SelectItem>
                    <SelectItem value="3">3 Months</SelectItem>
                    <SelectItem value="4">4 Months</SelectItem>
                    <SelectItem value="5">5 Months</SelectItem>
                    <SelectItem value="6">6 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Medicine Code (Optional grouping) */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <MedicineCodeCombobox value={medicineCodeId} onChange={setMedicineCodeId} />
          </div>

          {/* Record in Expense checkbox */}
          <div className="flex items-center space-x-2 rounded-md border p-3 bg-muted/30">
            <Checkbox
              id="edit-record-in-expense"
              checked={recordInExpense}
              onCheckedChange={(checked) => setRecordInExpense(!!checked)}
            />
            <Label htmlFor="edit-record-in-expense" className="text-sm cursor-pointer">
              Record in Expense
            </Label>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Updating..." : `Update ${isPharmacy ? 'Medicine' : 'Item'}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
