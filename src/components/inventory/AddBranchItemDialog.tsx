import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { createBatch } from '@/lib/batchInventory';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import CreateCustomItemDialog from './CreateCustomItemDialog';
import { logActivity } from '@/lib/activityLog';
import { usePackaging, effectivePackaging } from '@/hooks/usePackaging';
import { autoStripPrice, autoPackPrice } from '@/lib/packaging';

interface CatalogItem {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  item_type?: string;
  unit_label?: string;
  units_per_pack?: number;
  minimum_stock_level?: number;
}

interface AddBranchItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemAdded: () => void;
}

export default function AddBranchItemDialog({ open, onOpenChange, onItemAdded }: AddBranchItemDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<'paid' | 'credit'>('paid');
  const [recordInExpense, setRecordInExpense] = useState(true);
  const [extraCatalogItems, setExtraCatalogItems] = useState<CatalogItem[]>([]);

  // Form fields for branch-specific values
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [minStockLevel, setMinStockLevel] = useState('');

  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';

  // Resolve owner ID once (cached) — staff users have to look up via branch.
  const { data: ownerId } = useQuery({
    queryKey: ['resolved-owner-id', profile?.id, profile?.role, profile?.branch_id],
    queryFn: async () => {
      if (!profile) return null;
      if (profile.role === 'owner' || profile.role === 'developer') return profile.id;
      if (profile.role === 'staff' && profile.branch_id) {
        const { data } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .single();
        return data?.pharmacy_owner_id || null;
      }
      return null;
    },
    enabled: !!profile,
    staleTime: 1000 * 60 * 30,
  });

  const queryClient = useQueryClient();
  const catalogKey = ['add-item-catalog', ownerId];

  // Catalog items — progressive load: first 24 immediately, then rest in background.
  const { data: catalogItems = [], isLoading: catalogLoading, refetch: refetchCatalog } = useQuery({
    queryKey: catalogKey,
    queryFn: async (): Promise<CatalogItem[]> => {
      if (!ownerId) return [];
      const { data: ownerGroups } = await supabase
        .from('owner_item_groups')
        .select('group_id')
        .eq('owner_id', ownerId);
      if (!ownerGroups || ownerGroups.length === 0) return [];
      const groupIds = ownerGroups.map((og: any) => og.group_id);

      const { data: groupMembers } = await supabase
        .from('grouped_item_members')
        .select('medicine_id')
        .in('group_id', groupIds);
      if (!groupMembers || groupMembers.length === 0) return [];

      const medicineIds = [...new Set(groupMembers.map((gm: any) => gm.medicine_id))];
      const SELECT = 'id, name, generic_name, category, manufacturer, batch_number, item_type, unit_label, units_per_pack, minimum_stock_level';

      // First page: 24 items, render immediately.
      const firstIds = medicineIds.slice(0, 24);
      const { data: firstMeds } = await supabase
        .from('medicines')
        .select(SELECT)
        .in('id', firstIds)
        .order('name');
      const firstBatch = (firstMeds || []) as CatalogItem[];

      // Seed cache so UI shows the first 24 right away.
      queryClient.setQueryData(catalogKey, firstBatch);

      // Background: fetch the rest in chunks and append progressively.
      const restIds = medicineIds.slice(24);
      if (restIds.length > 0) {
        (async () => {
          const CHUNK = 200;
          const seen = new Set(firstBatch.map(m => m.id));
          let acc = [...firstBatch];
          for (let i = 0; i < restIds.length; i += CHUNK) {
            const chunk = restIds.slice(i, i + CHUNK);
            const { data: more } = await supabase
              .from('medicines')
              .select(SELECT)
              .in('id', chunk)
              .order('name');
            const fresh = ((more || []) as CatalogItem[]).filter(m => !seen.has(m.id));
            fresh.forEach(m => seen.add(m.id));
            acc = [...acc, ...fresh].sort((a, b) => a.name.localeCompare(b.name));
            queryClient.setQueryData(catalogKey, acc);
          }
        })();
      }

      return firstBatch;
    },
    enabled: !!ownerId && open,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  // Branches (owner only) — deferred until an item is selected so the catalog
  // list renders first without competing for bandwidth. Cached for revisits.
  const { data: branches = [] } = useQuery({
    queryKey: ['owner-branches-list', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile!.id)
        .order('name');
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!profile && profile.role === 'owner' && !!selectedItem,
    staleTime: 1000 * 60 * 5,
  });

  // Suppliers — deferred until an item is selected. Cached for revisits.
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id, name').order('name');
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: open && !!selectedItem,
    staleTime: 1000 * 60 * 5,
  });

  const loading = catalogLoading;
  const allCatalogItems = [...extraCatalogItems, ...catalogItems];

  useEffect(() => {
    if (open && profile) resetForm();
  }, [open, profile]);

  // Set default branch when branches/selectedBranch resolve.
  useEffect(() => {
    if (selectedBranch) setSelectedBranchId(selectedBranch);
    else if (branches.length > 0 && !selectedBranchId) setSelectedBranchId(branches[0].id);
  }, [selectedBranch, branches]);

  // Pre-fill min stock level from the selected item's existing value.
  useEffect(() => {
    if (selectedItem) {
      setMinStockLevel(selectedItem.minimum_stock_level != null ? String(selectedItem.minimum_stock_level) : '');
    }
  }, [selectedItem]);

  const resetForm = () => {
    setSelectedItem(null);
    setSearchTerm('');
    setSellingPrice('');
    setPurchasePrice('');
    setQuantity('');
    setExpiryDate('');
    setBatchNumber('');
    setMinStockLevel('');
    setSelectedSupplierId('');
    setPaymentType('paid');
    setRecordInExpense(true);
  };

  const filteredItems = allCatalogItems.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.generic_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!selectedItem || !selectedBranchId || !sellingPrice || !purchasePrice || !quantity) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    if (!batchNumber.trim()) {
      toast({ title: 'Batch number required', description: 'Please enter a batch number.', variant: 'destructive' });
      return;
    }
    if (!expiryDate) {
      toast({ title: 'Expiry date required', description: 'Please select an expiry date.', variant: 'destructive' });
      return;
    }
    if (minStockLevel === '' || isNaN(parseInt(minStockLevel)) || parseInt(minStockLevel) < 0) {
      toast({ title: 'Minimum stock level required', description: 'Please enter a valid minimum stock level (0 or more).', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const sp = parseFloat(sellingPrice);
      const pp = parseFloat(purchasePrice);
      const qty = parseFloat(quantity);

      // Check if branch_item already exists for this medicine+branch
      const { data: existingBI } = await supabase
        .from('branch_items')
        .select('id, quantity')
        .eq('branch_id', selectedBranchId)
        .eq('medicine_id', selectedItem.id)
        .maybeSingle();

      let branchItemId: string;

      if (existingBI) {
        // Branch item exists — just add a new batch
        branchItemId = existingBI.id;
      } else {
        // Create new branch_item (quantity will be synced from batches)
        const { data: newBI, error } = await supabase.from('branch_items').insert({
          owner_id: profile?.id,
          branch_id: selectedBranchId,
          medicine_id: selectedItem.id,
          selling_price: sp,
          purchase_price: pp,
          quantity: qty,
          expiry_date: expiryDate || null,
        }).select('id').single();

        if (error) {
          if (error.code === '23505') {
            toast({ title: 'Error', description: 'This item already exists in this branch. Edit the existing entry instead.', variant: 'destructive' });
          } else {
            throw error;
          }
          setSubmitting(false);
          return;
        }
        branchItemId = newBI.id;
      }

      // Create inventory batch
      const { error: batchErr } = await createBatch({
        branchId: selectedBranchId,
        medicineId: selectedItem.id,
        branchItemId,
        supplierId: selectedSupplierId || null,
        batchNumber: batchNumber || null,
        quantity: qty,
        purchasePrice: pp,
        sellingPrice: sp,
        expiryDate: expiryDate || null,
        createdBy: user?.id || null,
      });

      if (batchErr) throw batchErr;

      // Log activity
      logActivity({
        type: 'create_item',
        entityType: 'branch_item',
        entityId: branchItemId,
        next: { name: selectedItem.name, quantity: qty, selling_price: sp, purchase_price: pp, expiry_date: expiryDate || null },
        metadata: { item_name: selectedItem.name, quantity: qty, selling_price: sp },
      });

      const totalAmount = qty * pp;

      // Record supplier purchase if supplier is selected
      if (selectedSupplierId) {
        await supabase.from('supplier_purchases').insert({
          supplier_id: selectedSupplierId,
          item_name: selectedItem.name,
          quantity: qty,
          unit_cost: pp,
          total_cost: totalAmount,
          payment_type: paymentType,
          branch_id: selectedBranchId,
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

      // Record expense
      if (recordInExpense && qty > 0 && pp > 0) {
        await supabase.from('expenses').insert({
          description: `Purchase of ${selectedItem.name} (${qty} units)${batchNumber ? ` [Batch: ${batchNumber}]` : ''}`,
          amount: totalAmount,
          category: 'Stock Purchase',
          created_by: user?.id || null,
          branch_id: selectedBranchId,
        });
      }

      // Update master medicine's minimum stock level if provided/changed.
      if (minStockLevel !== '') {
        const newMin = parseInt(minStockLevel);
        if (!isNaN(newMin) && newMin !== (selectedItem.minimum_stock_level ?? null)) {
          await supabase.from('medicines').update({ minimum_stock_level: newMin }).eq('id', selectedItem.id);
        }
      }
      toast({ title: 'Success', description: `${selectedItem.name} added to branch inventory (Batch created)` });
      window.dispatchEvent(new Event('app:refresh'));
      onItemAdded();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to add item', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Inventory Item</DialogTitle>
          <DialogDescription>
            Select an item from the catalog and configure branch-specific values
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: Search and select item */}
          {!selectedItem ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search catalog items..."
                    className="pl-8"
                  />
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowCustomDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Custom Item
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {catalogItems.length === 0
                    ? 'No items available. Contact your administrator to assign item groups.'
                    : 'No items match your search.'}
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                  {filteredItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-sm">{item.name}</p>
                        {item.generic_name && (
                          <p className="text-xs text-muted-foreground">{item.generic_name}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                        {item.manufacturer && (
                          <Badge variant="secondary" className="text-xs">{item.manufacturer}</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Selected item info */}
              <div className="bg-muted/40 rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{selectedItem.name}</p>
                    {selectedItem.generic_name && (
                      <p className="text-sm text-muted-foreground">{selectedItem.generic_name}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSelectedItem(null)}>
                    Change
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{selectedItem.category}</Badge>
                  {selectedItem.manufacturer && <Badge variant="secondary">{selectedItem.manufacturer}</Badge>}
                  {selectedItem.item_type && <Badge variant="secondary">{selectedItem.item_type}</Badge>}
                </div>
              </div>

              {/* Step 2: Branch-specific configuration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {branches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Branch *</Label>
                    <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branches.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <PriceWithBreakdown
                  label="Selling Price"
                  medicineId={selectedItem.id}
                  value={sellingPrice}
                  onChange={setSellingPrice}
                  kind="sell"
                />

                <PriceWithBreakdown
                  label="Purchase Price (Cost)"
                  medicineId={selectedItem.id}
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                  kind="buy"
                />

                <div className="space-y-2">
                  <Label>Quantity *</Label>
                  <Input
                    type="number"
                    step={selectedItem.item_type === 'measurable' ? '0.01' : '1'}
                    min="0"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Batch Number *</Label>
                  <Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. BN-2026-001" required />
                </div>

                <div className="space-y-2">
                  <Label>Expiry Date *</Label>
                  <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} required />
                </div>

                <div className="space-y-2">
                  <Label>Minimum Stock Level *</Label>
                  <Input
                    type="number"
                    min="0"
                    value={minStockLevel}
                    onChange={e => setMinStockLevel(e.target.value)}
                    placeholder="e.g. 5"
                    required
                  />
                </div>
              </div>

              {/* Supplier (Optional) */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <Label className="text-sm font-semibold">Link to Supplier (Optional)</Label>
                <Select value={selectedSupplierId || 'none'} onValueChange={val => setSelectedSupplierId(val === 'none' ? '' : val)}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Supplier</SelectItem>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSupplierId && (
                  <div className="space-y-2">
                    <Label className="text-sm">Payment Type</Label>
                    <Select value={paymentType} onValueChange={val => setPaymentType(val as 'paid' | 'credit')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="credit">Credit (Debt)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Record in expense */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="record_expense"
                  checked={recordInExpense}
                  onCheckedChange={(checked) => setRecordInExpense(!!checked)}
                />
                <Label htmlFor="record_expense" className="text-sm cursor-pointer">
                  Record as expense (Stock Purchase)
                </Label>
              </div>

              <Button onClick={handleSubmit} disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add to Branch Inventory
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <CreateCustomItemDialog
      open={showCustomDialog}
      onOpenChange={setShowCustomDialog}
      onItemCreated={(item) => {
        setExtraCatalogItems(prev => [item as CatalogItem, ...prev]);
        setSelectedItem(item as CatalogItem);
        refetchCatalog();
      }}
    />
    </>
  );
}

/**
 * Price input for the LPI (smallest sellable unit / tablet) with a read-only
 * preview of the auto-derived strip and pack prices based on the medicine's
 * packaging configuration.
 */
function PriceWithBreakdown({
  label,
  medicineId,
  value,
  onChange,
  kind,
}: {
  label: string;
  medicineId: string;
  value: string;
  onChange: (v: string) => void;
  kind: 'sell' | 'buy';
}) {
  const { packaging } = usePackaging(medicineId);
  const p = effectivePackaging(packaging);
  const unitName = p.unit_name || 'unit';
  const stripName = p.strip_name || 'strip';
  const packName = p.pack_name || 'pack';
  const lpi = parseFloat(value);
  const validLpi = Number.isFinite(lpi) && lpi >= 0;
  const stripPrice = validLpi
    ? autoStripPrice({ ...p, unit_selling_price: lpi })
    : null;
  const packPrice = validLpi
    ? autoPackPrice({
        ...p,
        unit_selling_price: lpi,
        strip_selling_price: stripPrice ?? null,
      })
    : null;

  return (
    <div className="space-y-2">
      <Label>
        {label} per {unitName} *
      </Label>
      <Input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
      />
      {(p.strip_enabled || p.pack_enabled) && (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground space-y-0.5">
          {p.strip_enabled && p.units_per_strip ? (
            <div>
              {kind === 'sell' ? 'Strip price' : 'Strip cost'}:{' '}
              <span className="font-medium text-foreground">
                {stripPrice != null ? stripPrice.toFixed(2) : '—'}
              </span>{' '}
              <span className="opacity-70">
                ({p.units_per_strip} {unitName}/{stripName})
              </span>
            </div>
          ) : null}
          {p.pack_enabled && p.strips_per_pack && p.units_per_strip ? (
            <div>
              {kind === 'sell' ? 'Pack price' : 'Pack cost'}:{' '}
              <span className="font-medium text-foreground">
                {packPrice != null ? packPrice.toFixed(2) : '—'}
              </span>{' '}
              <span className="opacity-70">
                ({p.strips_per_pack} {stripName}/{packName})
              </span>
            </div>
          ) : null}
          <div className="opacity-70 italic">Auto-calculated from {unitName} price.</div>
        </div>
      )}
    </div>
  );
}
