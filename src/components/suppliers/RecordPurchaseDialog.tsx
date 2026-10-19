import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, X } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';
import { createBatch } from '@/lib/batchInventory';

interface RecordPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  onPurchaseRecorded: () => void;
}

export default function RecordPurchaseDialog({ open, onOpenChange, supplierId, supplierName, onPurchaseRecorded }: RecordPurchaseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [itemType, setItemType] = useState<'full_pcs' | 'measurable'>('full_pcs');
  const [measurableUnit, setMeasurableUnit] = useState<string>('kg');
  const [recordInExpense, setRecordInExpense] = useState(true);
  const [paymentType, setPaymentType] = useState<'paid' | 'credit'>('paid');
  const [userRole, setUserRole] = useState<'owner' | 'staff' | null>(null);

  // Existing item picker
  type ExistingItem = {
    id: string; name: string; generic_name: string | null; category: string;
    manufacturer: string | null; item_type: string | null; unit_label: string | null;
    units_per_pack: number | null; minimum_stock_level: number | null;
  };
  const [existingItems, setExistingItems] = useState<ExistingItem[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedExisting, setSelectedExisting] = useState<ExistingItem | null>(null);

  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, userBranch, branchType } = useBranchContext();
  const isGeneral = branchType !== 'pharmacy';
  const { categories } = useCustomCategories(isGeneral ? 'general' : 'pharmacy');

  const label = isGeneral
    ? { item: 'Item', genericName: 'Description', manufacturer: 'Brand' }
    : { item: 'Medicine', genericName: 'Generic Name', manufacturer: 'Manufacturer' };

  useEffect(() => {
    const fetchUserRoleAndBranches = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profileData) {
        setUserRole(profileData.role as 'owner' | 'staff');
        if (profileData.role === 'owner') {
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
        } else if (profileData.role === 'staff' && userBranch) {
          setSelectedBranchId(userBranch);
        }
      }
    };

    if (open) {
      fetchUserRoleAndBranches();
      setItemType('full_pcs');
      setPaymentType('paid');
      setRecordInExpense(true);
      setSelectedExisting(null);
      setPickerSearch('');
    }
  }, [open, selectedBranch, userBranch]);

  // Fetch owner's existing items (medicines catalog) for the picker
  useEffect(() => {
    if (!open) return;
    (async () => {
      let ownerId: string | null = null;
      if (profile?.role === 'owner') ownerId = profile.id;
      else if (profile?.role === 'staff' && profile.branch_id) {
        const { data } = await supabase
          .from('pharmacy_branches').select('pharmacy_owner_id').eq('id', profile.branch_id).single();
        ownerId = (data as any)?.pharmacy_owner_id ?? null;
      }
      if (!ownerId) return;
      const { data: ownerGroups } = await supabase
        .from('owner_item_groups').select('group_id').eq('owner_id', ownerId);
      const groupIds = (ownerGroups || []).map((g: any) => g.group_id);
      if (groupIds.length === 0) { setExistingItems([]); return; }
      const { data: members } = await supabase
        .from('grouped_item_members').select('medicine_id').in('group_id', groupIds);
      const ids = [...new Set((members || []).map((m: any) => m.medicine_id))];
      if (ids.length === 0) { setExistingItems([]); return; }
      const { data: meds } = await supabase
        .from('medicines')
        .select('id, name, generic_name, category, manufacturer, item_type, unit_label, units_per_pack, minimum_stock_level')
        .in('id', ids)
        .order('name')
        .limit(2000);
      setExistingItems((meds || []) as ExistingItem[]);
    })();
  }, [open, profile?.id, profile?.role, profile?.branch_id]);

  const filteredExisting = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return existingItems.slice(0, 50);
    return existingItems
      .filter(it => it.name.toLowerCase().includes(q) || (it.generic_name || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [existingItems, pickerSearch]);

  // When user picks an existing item, prefill the form's controlled fields.
  useEffect(() => {
    if (!selectedExisting) return;
    setItemType((selectedExisting.item_type as 'full_pcs' | 'measurable') || 'full_pcs');
  }, [selectedExisting]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    const branchId = selectedBranchId || userBranch || selectedBranch;

    if (!branchId) {
      toast({ title: 'Error', description: 'Please select a branch first', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const selectedCategory = (formData.get('category') as string) || selectedExisting?.category || 'other';
    const unitLabel = itemType === 'measurable'
      ? measurableUnit
      : (formData.get('unit_label') as string || selectedExisting?.unit_label || 'strip');
    const unitsPerPackValue = formData.get('units_per_pack') as string;
    const unitsPerPack = itemType === 'full_pcs'
      ? (unitsPerPackValue ? parseInt(unitsPerPackValue) : (selectedExisting?.units_per_pack ?? null))
      : null;

    const stockQtyRaw = formData.get('stock_quantity') as string;
    const stockQuantity = itemType === 'measurable' ? parseFloat(stockQtyRaw) : parseInt(stockQtyRaw);
    const purchasePrice = parseFloat(formData.get('purchase_price') as string);
    const sellingPrice = parseFloat(formData.get('selling_price') as string);
    const itemName = selectedExisting?.name || (formData.get('name') as string);
    const totalCost = stockQuantity * purchasePrice;

    try {
      let medicineId: string;

      if (selectedExisting) {
        // Reuse existing master catalog item
        medicineId = selectedExisting.id;
      } else {
        // 1. Insert into medicines (inventory catalog)
        const medicineData: Record<string, any> = {
          name: itemName,
          generic_name: formData.get('generic_name') as string || null,
          category: selectedCategory,
          manufacturer: formData.get('manufacturer') as string || null,
          batch_number: formData.get('batch_number') as string || null,
          country_name: formData.get('country_name') as string || null,
          purchase_price: purchasePrice,
          selling_price: sellingPrice,
          stock_quantity: stockQuantity,
          minimum_stock_level: parseInt(formData.get('minimum_stock_level') as string),
          units_per_pack: unitsPerPack,
          unit_label: unitLabel,
          open_pack_units: 0,
          expiry_alert_enabled: formData.get('expiry_alert_enabled') === 'on',
          branch_id: branchId,
          created_by: user?.id || null,
          item_type: itemType,
          supplier_id: supplierId,
        };

        const { data: medResult, error: medicineErr } = await supabase.from('medicines').insert([medicineData]).select('id').single();
        if (medicineErr) throw medicineErr;
        medicineId = medResult.id;
      }

      // 1b. Find or create branch_item for this medicine+branch
      let branchItemId: string | null = null;
      const { data: existingBI } = await supabase
        .from('branch_items')
        .select('id')
        .eq('branch_id', branchId)
        .eq('medicine_id', medicineId)
        .maybeSingle();

      if (existingBI) {
        branchItemId = (existingBI as any).id;
      } else {
        const { data: newBI, error: biErr } = await supabase.from('branch_items').insert({
          owner_id: profile?.id,
          branch_id: branchId,
          medicine_id: medicineId,
          selling_price: sellingPrice,
          purchase_price: purchasePrice,
          quantity: stockQuantity,
        }).select('id').single();
        if (biErr) {
          console.warn('Branch item creation failed:', biErr);
        } else {
          branchItemId = newBI.id;
        }
      }

      if (branchItemId) {
        await createBatch({
          branchId,
          medicineId,
          branchItemId,
          supplierId,
          batchNumber: formData.get('batch_number') as string || null,
          quantity: stockQuantity,
          purchasePrice,
          sellingPrice,
          expiryDate: null, // expiry now lives on batches; user can set via Batches view
          createdBy: user?.id || null,
        });
      }


      // 2. Insert purchase record
      const { error: purchaseErr } = await supabase.from('supplier_purchases').insert({
        supplier_id: supplierId,
        item_name: itemName,
        quantity: stockQuantity,
        unit_cost: purchasePrice,
        total_cost: totalCost,
        payment_type: paymentType,
        notes: formData.get('notes') as string || null,
        branch_id: branchId,
        created_by: profile?.id,
      });
      if (purchaseErr) throw purchaseErr;

      // 3. If credit, update supplier debt
      if (paymentType === 'credit') {
        const { data: existing } = await supabase
          .from('supplier_debts')
          .select('id, total_debt')
          .eq('supplier_id', supplierId)
          .maybeSingle();

        if (existing) {
          await supabase.from('supplier_debts').update({
            total_debt: Number(existing.total_debt) + totalCost,
            last_updated: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await supabase.from('supplier_debts').insert({
            supplier_id: supplierId,
            total_debt: totalCost,
            branch_id: branchId,
          });
        }
      }

      // 4. Record expense if checkbox is checked
      if (recordInExpense && stockQuantity > 0 && purchasePrice > 0) {
        const unit = (unitLabel || 'unit').toUpperCase();
        const qtyLabel = itemType === 'measurable' ? `${stockQuantity} ${unit}` : `${stockQuantity} ${unitLabel || 'pcs'}`;
        await supabase.from('expenses').insert({
          description: `Purchase from ${supplierName}: ${itemName} (${qtyLabel})`,
          amount: totalCost,
          category: 'Stock Purchase',
          created_by: user?.id || null,
          branch_id: branchId,
        });
      }

      toast({ title: 'Success', description: `${itemName} added to inventory and purchase recorded` });
      onPurchaseRecorded();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to record purchase', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Purchase — {supplierName}</DialogTitle>
          <DialogDescription>
            Add a new {label.item.toLowerCase()} from this supplier. It will be added to your inventory.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Existing item picker */}
          <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
            <Label className="text-sm font-semibold">Pick an existing {label.item.toLowerCase()} (optional)</Label>
            {selectedExisting ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{selectedExisting.name}</p>
                  <div className="flex gap-1 mt-1">
                    <Badge variant="outline" className="text-xs">{selectedExisting.category}</Badge>
                    {selectedExisting.manufacturer && <Badge variant="secondary" className="text-xs">{selectedExisting.manufacturer}</Badge>}
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedExisting(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    placeholder={`Search inventory catalog...`}
                    className="pl-8 h-9"
                  />
                </div>
                {pickerSearch && (
                  <div className="max-h-40 overflow-y-auto border rounded-md divide-y bg-background">
                    {filteredExisting.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">No matches — fill the form below to create a new one.</div>
                    ) : filteredExisting.map(it => (
                      <button
                        type="button" key={it.id}
                        onClick={() => setSelectedExisting(it)}
                        className="w-full text-left px-2 py-1.5 hover:bg-muted/50 text-sm"
                      >
                        <div className="font-medium">{it.name}</div>
                        {it.generic_name && <div className="text-xs text-muted-foreground">{it.generic_name}</div>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Or leave blank and fill the form below to add a brand-new item.</p>
              </>
            )}
          </div>

          {/* Item Type Selection — only shown when creating a new item */}
          {!selectedExisting && (
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
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!selectedExisting && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">{label.item} Name *</Label>
                  <Input id="name" name="name" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="generic_name">{label.genericName}</Label>
                  <Input id="generic_name" name="generic_name" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select name="category" required>
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
                  <Input id="manufacturer" name="manufacturer" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country_name">Country Name</Label>
                  <Input id="country_name" name="country_name" />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" name="batch_number" placeholder="For this batch" />
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
              <Input id="purchase_price" name="purchase_price" type="number" step="0.01" min="0" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price {itemType === 'measurable' ? `per ${measurableUnit}` : ''} *</Label>
              <Input id="selling_price" name="selling_price" type="number" step="0.01" min="0" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stock Quantity {itemType === 'measurable' ? `(${measurableUnit})` : ''} *</Label>
              <Input
                id="stock_quantity"
                name="stock_quantity"
                type="number"
                step={itemType === 'measurable' ? '0.01' : '1'}
                min="0"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum_stock_level">Minimum Stock Level (for alert!) *</Label>
              <Input id="minimum_stock_level" name="minimum_stock_level" type="number" min="0" defaultValue="10" required />
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

            {/* Unit Label & Units Per Pack — only for Full PCS */}
            {itemType === 'full_pcs' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="unit_label">Unit Label</Label>
                  <Input id="unit_label" name="unit_label" placeholder="e.g. strip, piece, bottle" defaultValue="strip" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="units_per_pack">Units Per Stock</Label>
                  <Input id="units_per_pack" name="units_per_pack" type="number" min="1" placeholder="Leave empty if not sold by unit" />
                </div>
              </>
            )}

            {/* Expiry date is captured per-batch — see the Batches view for this item */}

            <div className="space-y-2">
              <Label>Payment Type *</Label>
              <Select value={paymentType} onValueChange={(v: 'paid' | 'credit') => setPaymentType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="credit">Credit (Add to Supplier Debt)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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
              Add {label.item} & Record Purchase
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
