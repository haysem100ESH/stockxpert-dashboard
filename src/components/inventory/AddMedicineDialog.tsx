import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';
import MedicineCodeCombobox from './MedicineCodeCombobox';
import PackagingEditor from './PackagingEditor';
import StockEntryFields, { StockEntry, emptyStockEntry, entryToUnits } from './StockEntryFields';
import { defaultPackaging, Packaging, autoStripPrice, autoPackPrice } from '@/lib/packaging';

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
  unit_label?: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface AddMedicineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMedicineAdded: () => void;
  replicateData?: Medicine | null;
  mode?: 'pharmacy' | 'general';
}

export default function AddMedicineDialog({ open, onOpenChange, onMedicineAdded, replicateData, mode = 'pharmacy' }: AddMedicineDialogProps) {
  const isGeneral = mode === 'general';
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [itemType, setItemType] = useState<'full_pcs' | 'measurable'>('full_pcs');
  const [measurableUnit, setMeasurableUnit] = useState<string>('kg');
  const [recordInExpense, setRecordInExpense] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<'paid' | 'credit'>('paid');
  const [medicineCodeId, setMedicineCodeId] = useState<string | null>(null);
  const [packaging, setPackaging] = useState<Packaging>(defaultPackaging());
  const [stockEntry, setStockEntry] = useState<StockEntry>(emptyStockEntry());
  const { toast } = useToast();
  const { selectedBranch, userBranch } = useBranchContext();
  const { categories } = useCustomCategories(isGeneral ? 'general' : 'pharmacy');
  
  const label = isGeneral
    ? { item: 'Item', genericName: 'Description', manufacturer: 'Brand', success: 'Item added successfully', fail: 'Failed to add item' }
    : { item: 'Medicine', genericName: 'Generic Name', manufacturer: 'Manufacturer', success: 'Medicine added successfully', fail: 'Failed to add medicine' };
  
  const [userRole, setUserRole] = useState<'owner' | 'staff' | null>(null);

  // Infer item type from replicateData
  useEffect(() => {
    if (replicateData?.unit_label) {
      const isMeasUnit = MEASURABLE_UNIT_OPTIONS.some(o => o.value === replicateData.unit_label?.toLowerCase());
      if (isMeasUnit) {
        setItemType('measurable');
        setMeasurableUnit(replicateData.unit_label.toLowerCase());
      } else {
        setItemType('full_pcs');
      }
    }
  }, [replicateData]);
  
  useEffect(() => {
    const fetchUserRoleAndBranchesAndSuppliers = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        setUserRole(profile.role as 'owner' | 'staff');
        
        // Fetch all suppliers
        const { data: suppliersData } = await supabase
          .from('suppliers')
          .select('id, name')
          .order('name');
        if (suppliersData) setSuppliers(suppliersData);
        
        if (profile.role === 'owner') {
          const { data: branchesData } = await supabase
            .from('pharmacy_branches')
            .select('id, name')
            .eq('pharmacy_owner_id', user.id)
            .order('is_main_branch', { ascending: false })
            .order('name');
          
          if (branchesData) {
            setBranches(branchesData);
            if (selectedBranch) {
              setSelectedBranchId(selectedBranch);
            } else if (branchesData.length > 0) {
              setSelectedBranchId(branchesData[0].id);
            }
          }
        } else if (profile.role === 'staff' && userBranch) {
          setSelectedBranchId(userBranch);
        }
      }
    };
    
    if (open) {
      fetchUserRoleAndBranchesAndSuppliers();
      setItemType('full_pcs');
      setSelectedSupplierId('');
      setPaymentType('paid');
      setMedicineCodeId(null);
      setPackaging(defaultPackaging());
      setStockEntry(emptyStockEntry());
    }
  }, [open, selectedBranch, userBranch]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    
    const selectedCategory = (formData.get('category') as string) || 'other';

    const isMeas = itemType === 'measurable';
    const unitLabel = isMeas ? measurableUnit : (packaging.unit_name || 'unit');

    // Derive legacy packaging columns for back-compat
    let unitsPerPack: number | null = null;
    let stripsPerPack: number | null = null;
    let unitsPerStrip: number | null = null;
    let packagingMode: string | null = null;
    if (!isMeas) {
      if (packaging.strip_enabled && packaging.units_per_strip) {
        unitsPerStrip = packaging.units_per_strip;
        packagingMode = 'with_strip';
        if (packaging.pack_enabled && packaging.strips_per_pack) {
          stripsPerPack = packaging.strips_per_pack;
          unitsPerPack = packaging.strips_per_pack * packaging.units_per_strip;
        } else {
          unitsPerPack = packaging.units_per_strip;
        }
      } else {
        packagingMode = 'no_strip';
      }
    }

    const stockQtyRaw = formData.get('stock_quantity') as string;
    const stockQuantity = isMeas
      ? parseFloat(stockQtyRaw)
      : entryToUnits(stockEntry, packaging);

    const medicineData: Record<string, any> = {
      name: formData.get('name') as string,
      generic_name: formData.get('generic_name') as string || null,
      category: selectedCategory,
      manufacturer: formData.get('manufacturer') as string || null,
      batch_number: formData.get('batch_number') as string || null,
      country_name: formData.get('country_name') as string || null,
      purchase_price: parseFloat(formData.get('purchase_price') as string),
      selling_price: parseFloat(formData.get('selling_price') as string),
      stock_quantity: stockQuantity,
      minimum_stock_level: (() => { const v = formData.get('minimum_stock_level') as string; const n = parseInt(v); return isNaN(n) ? null : n; })(),
      units_per_pack: unitsPerPack,
      strips_per_pack: stripsPerPack,
      units_per_strip: unitsPerStrip,
      packaging_mode: packagingMode,
      unit_label: unitLabel,
      open_pack_units: 0,
      expiry_date: formData.get('expiry_date') as string || null,
      expiry_alert_enabled: formData.get('expiry_alert_enabled') === 'on',
      branch_id: selectedBranchId || userBranch || selectedBranch || null,
      created_by: user?.id || null,
      item_type: itemType,
      medicine_code_id: medicineCodeId,
    };

    try {
      const { data: insertedMed, error } = await supabase
        .from('medicines')
        .insert([medicineData])
        .select('id')
        .single();
      if (error) throw error;

      // Upsert packaging row (Full PCS items only)
      if (insertedMed?.id && itemType === 'full_pcs') {
        const stripPrice = packaging.strip_selling_price ?? autoStripPrice(packaging);
        const packPrice = packaging.pack_selling_price ?? autoPackPrice(packaging);
        await (supabase as any).from('medicine_packaging').upsert({
          medicine_id: insertedMed.id,
          unit_name: packaging.unit_name || 'unit',
          strip_enabled: packaging.strip_enabled,
          units_per_strip: packaging.strip_enabled ? packaging.units_per_strip : null,
          strip_name: packaging.strip_enabled ? (packaging.strip_name || 'strip') : null,
          pack_enabled: packaging.pack_enabled,
          strips_per_pack: packaging.pack_enabled ? packaging.strips_per_pack : null,
          pack_name: packaging.pack_enabled ? (packaging.pack_name || 'pack') : null,
          unit_selling_price: packaging.unit_selling_price ?? null,
          strip_selling_price: stripPrice ?? null,
          pack_selling_price: packPrice ?? medicineData.selling_price ?? null,
        }, { onConflict: 'medicine_id' });
      }

      const totalAmount = stockQuantity * medicineData.purchase_price;
      const branchId = selectedBranchId || userBranch || selectedBranch || null;

      // Record supplier purchase if supplier is selected
      if (selectedSupplierId) {
        await supabase.from('supplier_purchases').insert({
          supplier_id: selectedSupplierId,
          item_name: medicineData.name,
          quantity: stockQuantity,
          unit_cost: medicineData.purchase_price,
          total_cost: totalAmount,
          payment_type: paymentType,
          branch_id: branchId,
          created_by: user?.id || null,
        });

        // Update supplier debt if credit purchase
        if (paymentType === 'credit') {
          const { data: existingDebt } = await supabase
            .from('supplier_debts')
            .select('id, total_debt')
            .eq('supplier_id', selectedSupplierId)
            .maybeSingle();

          if (existingDebt) {
            await supabase
              .from('supplier_debts')
              .update({ total_debt: existingDebt.total_debt + totalAmount })
              .eq('id', existingDebt.id);
          } else {
            await supabase.from('supplier_debts').insert({
              supplier_id: selectedSupplierId,
              total_debt: totalAmount,
            });
          }
        }
      }

      // Record expense if checkbox is checked
      if (recordInExpense && stockQuantity > 0 && medicineData.purchase_price > 0) {
        const itemName = medicineData.name || 'Item';
        const unit = (unitLabel || 'unit').toUpperCase();
        const qtyLabel = itemType === 'measurable' ? `${stockQuantity} ${unit}` : `${stockQuantity} ${unitLabel || 'pcs'}`;
        await supabase.from('expenses').insert({
          description: `Purchase of ${itemName} (${qtyLabel})`,
          amount: totalAmount,
          category: 'Stock Purchase',
          created_by: user?.id || null,
          branch_id: branchId,
        });
      }

      toast({ title: "Success", description: label.success });
      onMedicineAdded();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: label.fail, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replicateData ? `Replicate ${label.item}` : `Add New ${label.item}`}</DialogTitle>
          <DialogDescription>
            {replicateData ? `Create a new ${label.item.toLowerCase()} based on existing data` : `Enter the details for the new ${label.item.toLowerCase()}`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Item Type Selection */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <Label className="text-sm font-semibold">Item Type *</Label>
            <RadioGroup
              value={itemType}
              onValueChange={(val) => setItemType(val as 'full_pcs' | 'measurable')}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="full_pcs" id="type_full_pcs" />
                <Label htmlFor="type_full_pcs" className="cursor-pointer">
                  <span className="font-medium">Full PCS</span>
                  <span className="block text-xs text-muted-foreground">Countable items (pieces, packs, strips)</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="measurable" id="type_measurable" />
                <Label htmlFor="type_measurable" className="cursor-pointer">
                  <span className="font-medium">Measurable</span>
                  <span className="block text-xs text-muted-foreground">Kg, Liter, Gram, Meter, etc.</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{label.item} Name *</Label>
              <Input id="name" name="name" defaultValue={replicateData?.name} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generic_name">{label.genericName}</Label>
              <Input id="generic_name" name="generic_name" defaultValue={replicateData?.generic_name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select name="category" defaultValue={replicateData?.category} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manufacturer">{label.manufacturer}</Label>
              <Input id="manufacturer" name="manufacturer" defaultValue={replicateData?.manufacturer} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" name="batch_number" defaultValue={replicateData?.batch_number} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country_name">Country Name</Label>
              <Input id="country_name" name="country_name" defaultValue={replicateData?.country_name} />
            </div>

            {userRole === 'owner' && branches.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="branch_id">Assign to Branch *</Label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="purchase_price">Purchase Price {itemType === 'measurable' ? `per ${measurableUnit}` : ''} *</Label>
              <Input id="purchase_price" name="purchase_price" type="number" step="0.01" min="0" defaultValue={replicateData?.purchase_price} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price {itemType === 'measurable' ? `per ${measurableUnit}` : ''} *</Label>
              <Input id="selling_price" name="selling_price" type="number" step="0.01" min="0" defaultValue={replicateData?.selling_price} required />
            </div>

            {itemType === 'measurable' && (
              <div className="space-y-2">
                <Label htmlFor="stock_quantity">Stock Quantity ({measurableUnit}) *</Label>
                <Input
                  id="stock_quantity"
                  name="stock_quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={replicateData?.stock_quantity}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="minimum_stock_level">Minimum Stock Level (for alert!)</Label>
              <Input id="minimum_stock_level" name="minimum_stock_level" type="number" min="0" defaultValue={replicateData ? replicateData.minimum_stock_level : ''} placeholder="Optional" />
            </div>

            {/* Measurable unit selector */}
            {itemType === 'measurable' && (
              <div className="space-y-2">
                <Label>Measurement Unit *</Label>
                <Select value={measurableUnit} onValueChange={setMeasurableUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEASURABLE_UNIT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Expiry date is captured per-batch (Batches view), not at item level */}
          </div>

          {/* Unit / Strip / Pack — only for Full PCS */}
          {itemType === 'full_pcs' && (
            <>
              <PackagingEditor value={packaging} onChange={setPackaging} />
              <StockEntryFields
                packaging={packaging}
                value={stockEntry}
                onChange={setStockEntry}
              />
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="expiry_alert_enabled">Alert me before expiry</Label>
            <Select name="expiry_alert_enabled" defaultValue="1">
              <SelectTrigger>
                <SelectValue placeholder="Select alert period" />
              </SelectTrigger>
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

          {/* Medicine Code (Optional grouping) */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <MedicineCodeCombobox value={medicineCodeId} onChange={setMedicineCodeId} />
          </div>

          {/* Supplier Selection (Optional) */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <Label className="text-sm font-semibold">Link to Supplier (Optional)</Label>
            <Select value={selectedSupplierId} onValueChange={(val) => setSelectedSupplierId(val === 'none' ? '' : val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select supplier (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Supplier</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedSupplierId && (
              <div className="space-y-2 pt-2">
                <Label className="text-sm">Payment Type</Label>
                <RadioGroup
                  value={paymentType}
                  onValueChange={(val) => setPaymentType(val as 'paid' | 'credit')}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="payment_paid" />
                    <Label htmlFor="payment_paid" className="cursor-pointer">Paid</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="credit" id="payment_credit" />
                    <Label htmlFor="payment_credit" className="cursor-pointer">Credit</Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>

          {/* Record in Expense checkbox */}
          <div className="flex items-center space-x-2 rounded-md border p-3 bg-muted/30">
            <Checkbox
              id="record-in-expense"
              checked={recordInExpense}
              onCheckedChange={(checked) => setRecordInExpense(!!checked)}
            />
            <Label htmlFor="record-in-expense" className="text-sm cursor-pointer">
              Record in Expense
            </Label>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {replicateData ? `Create ${label.item}` : `Add ${label.item}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
