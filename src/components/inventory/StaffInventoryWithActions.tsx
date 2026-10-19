import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Edit2, Plus, Trash2, Filter, Settings2, SlidersHorizontal, History, Layers, PackagePlus, Upload, Info } from 'lucide-react';
import MedicineInfoDialog from './MedicineInfoDialog';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useReadOnly } from '@/hooks/useReadOnly';
import { useBranchInventory } from '@/hooks/useBranchInventory';
import AddBranchItemDialog from './AddBranchItemDialog';
import EditBranchItemDialog, { type BranchItem } from './EditBranchItemDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CategoryManagement from './CategoryManagement';
import StockEditHistory from './StockEditHistory';
import BatchBreakdownDialog from './BatchBreakdownDialog';
import StockAdjustmentDialog from './StockAdjustmentDialog';
import ImportCsvDialog from './ImportCsvDialog';
import { formatMedicineName, formatPackaging } from '@/lib/medicineDisplay';
import { formatStock } from '@/lib/packaging';

const ITEMS_PER_PAGE = 24;

export default function StaffInventoryWithActions() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<BranchItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
  }>({ open: false, itemId: '', itemName: '' });
  const [cascadeConfirmation, setCascadeConfirmation] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
    saleCount: number;
  }>({ open: false, itemId: '', itemName: '', saleCount: 0 });
  const [hasBranches, setHasBranches] = useState(true);
  const [batchBreakdown, setBatchBreakdown] = useState<{ open: boolean; itemId: string; itemName: string }>({ open: false, itemId: '', itemName: '' });
  const [adjustingItem, setAdjustingItem] = useState<BranchItem | null>(null);
  const [infoItem, setInfoItem] = useState<{ branchItemId: string; medicineId?: string; name: string } | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const readOnly = useReadOnly();
  const isPharmacy = branchType === 'pharmacy';

  // Cache-first fetch via TanStack Query — instant hydration on revisit.
  const { items: branchItems, loading, refetch, removeItemFromCache } = useBranchInventory();
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!branchItems || branchItems.length === 0) { setBatchCounts({}); return; }
    const ids = branchItems.map((i: any) => i.id);
    let cancelled = false;
    (async () => {
      // Chunk + retry: previously this sent one massive .in() with hundreds of
      // branch_item_id UUIDs, which would silently fail on slow connections
      // and leave batch badges blank.
      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      const { data } = await chunkedInPartial<any>(ids, (chunk) =>
        supabase
          .from('inventory_batches')
          .select('branch_item_id')
          .in('branch_item_id', chunk)
          .gt('remaining_quantity', 0)
      );
      if (cancelled) return;
      const counts: Record<string, number> = {};
      data.forEach((r: any) => { counts[r.branch_item_id] = (counts[r.branch_item_id] || 0) + 1; });
      setBatchCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [branchItems]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    if (profile) checkBranches();
  }, [selectedBranch, profile?.id]);

  const checkBranches = async () => {
    try {
      let query = supabase.from('pharmacy_branches').select('id').limit(1);
      if (profile?.role === 'owner' && profile?.id) {
        query = query.eq('pharmacy_owner_id', profile.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      setHasBranches(data && data.length > 0);
    } catch (error) {
      console.error('Error checking branches:', error);
    }
  };

  // Derive filtered list with useMemo (no extra state, no effect-thrash).
  const filteredItems = useMemo(() => {
    const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
    const term = searchTerm.toLowerCase();
    return branchItems.filter((item: any) => {
      const ingredientsText = (item.active_ingredients || [])
        .map((i: any) => i.ingredient_name).join(' ').toLowerCase();
      const matchesSearch = item.name.toLowerCase().includes(term) ||
        (item.generic_name || '').toLowerCase().includes(term) ||
        (item.strength || '').toLowerCase().includes(term) ||
        (item.medicine_group || '').toLowerCase().includes(term) ||
        ingredientsText.includes(term);
      let matchesCategory = true;
      if (categoryFilter === 'medicines_only') {
        matchesCategory = medicineCategories.includes(item.category);
      } else if (categoryFilter !== 'all') {
        matchesCategory = item.category === categoryFilter;
      }
      const matchesGroup = groupFilter === 'all' || (item.medicine_group || '') === groupFilter;
      return matchesSearch && matchesCategory && matchesGroup;
    });
  }, [branchItems, searchTerm, categoryFilter, groupFilter]);

  // Reset to page 1 whenever filters change.
  useEffect(() => { setCurrentPage(1); }, [searchTerm, categoryFilter, selectedBranch]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredItems, currentPage]);

  const handleItemAdded = () => {
    refetch();
    setShowAddDialog(false);
  };

  const handleEditItem = (item: BranchItem) => {
    setEditingItem(item);
  };

  const handleItemUpdated = () => {
    refetch();
    setEditingItem(null);
  };

  const handleDeleteItem = (itemId: string, itemName: string) => {
    setDeleteConfirmation({ open: true, itemId, itemName });
  };

  const confirmDeleteItem = async () => {
    const itemId = deleteConfirmation.itemId;
    const itemName = deleteConfirmation.itemName;

    const { data, error } = await supabase.functions.invoke('delete-branch-item-cascade', {
      body: { itemId, cascade: false },
    });

    if (error) {
      toast({ title: 'Error', description: error.message || `Failed to delete ${isPharmacy ? 'medicine' : 'item'}.`, variant: 'destructive' });
      return;
    }

    if (data?.requiresCascade) {
      setDeleteConfirmation({ open: false, itemId: '', itemName: '' });
      setCascadeConfirmation({ open: true, itemId, itemName, saleCount: data.saleCount ?? 0 });
      return;
    }

    removeItemFromCache(itemId);
    toast({ title: 'Success', description: `${isPharmacy ? 'Medicine' : 'Item'} removed from branch` });
    setDeleteConfirmation({ open: false, itemId: '', itemName: '' });
  };

  const performDelete = async (itemId: string, cascade: boolean) => {
    try {
      const { error } = await supabase.functions.invoke('delete-branch-item-cascade', {
        body: { itemId, cascade },
      });
      if (error) throw error;

      removeItemFromCache(itemId);
      toast({
        title: 'Success',
        description: cascade
          ? `${isPharmacy ? 'Medicine' : 'Item'} and its sales history were permanently deleted`
          : `${isPharmacy ? 'Medicine' : 'Item'} removed from branch`,
      });
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || `Failed to delete ${isPharmacy ? 'medicine' : 'item'}. It may have related records.`, variant: 'destructive' });
    }
  };

  const confirmCascadeDelete = async () => {
    const itemId = cascadeConfirmation.itemId;
    await performDelete(itemId, true);
    setCascadeConfirmation({ open: false, itemId: '', itemName: '', saleCount: 0 });
  };

  const isOutOfStock = (item: BranchItem) => item.quantity === 0;
  const isLowStock = (item: BranchItem) => item.quantity > 0 && item.quantity <= 10;
  const uniqueCategories = useMemo(
    () => [...new Set(branchItems.map((i: any) => i.category).filter(Boolean))].sort() as string[],
    [branchItems]
  );
  const uniqueGroups = useMemo(
    () => [...new Set(branchItems.map((i: any) => i.medicine_group).filter(Boolean))].sort() as string[],
    [branchItems]
  );
  const getUniqueCategories = () => uniqueCategories;
  const getUniqueGroups = () => uniqueGroups;

  const isExpired = (item: BranchItem) => {
    if (!item.expiry_date) return false;
    const expiry = new Date(item.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (item: BranchItem) => {
    if (!item.expiry_date || isExpired(item)) return false;
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return new Date(item.expiry_date) <= thirtyDaysFromNow;
  };

  const renderItemCard = (item: BranchItem & { branch_name?: string; medicine_group?: string | null; strength?: string | null; active_ingredients?: Array<{ ingredient_name: string; strength: string | null }> }) => (
    <Card key={item.id} className={isExpired(item) ? 'border-destructive/30 bg-destructive/5' : ''}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
              <span>{isPharmacy ? formatMedicineName(item.name, item.strength) : item.name}</span>
              {batchCounts[item.id] > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setBatchBreakdown({ open: true, itemId: item.id, itemName: item.name }); }}
                  className="inline-flex"
                  title="View batch breakdown"
                >
                  <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-secondary/80">
                    {batchCounts[item.id]} batch{batchCounts[item.id] !== 1 ? 'es' : ''}
                  </Badge>
                </button>
              )}
            </CardTitle>
            {item.generic_name && <CardDescription>{item.generic_name}</CardDescription>}
          </div>
          <div className="flex space-x-1">
            <Button size="sm" variant="ghost" onClick={() => setInfoItem({ branchItemId: item.id, medicineId: (item as any).medicine_id, name: item.name })} title="Info"><Info className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setBatchBreakdown({ open: true, itemId: item.id, itemName: item.name })} title="View Batches"><Layers className="h-4 w-4" /></Button>
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => setAdjustingItem(item)} title="Adjust Stock"><PackagePlus className="h-4 w-4" /></Button>}
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => handleEditItem(item)} title="Edit"><Edit2 className="h-4 w-4" /></Button>}
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => handleDeleteItem(item.id, item.name)} title="Remove"><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span>Category:</span><Badge variant="outline">{item.category}</Badge></div>
          {isPharmacy && item.medicine_group && <div className="flex justify-between text-sm"><span>Group:</span><Badge variant="secondary" className="text-xs">{item.medicine_group}</Badge></div>}
          {isPharmacy && item.active_ingredients && item.active_ingredients.length > 0 && (
            <div className="text-xs bg-muted/50 rounded-md p-2 space-y-0.5">
              <div className="font-medium text-muted-foreground">Contains:</div>
              <div className="text-foreground">
                {item.active_ingredients.map((ing, i) => (
                  <span key={i}>
                    {i > 0 && ' + '}
                    {ing.ingredient_name}{ing.strength ? ` ${ing.strength}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          {isPharmacy && formatPackaging(item.strips_per_pack, item.units_per_strip, item.units_per_pack) && <div className="flex justify-between text-sm"><span>Packaging:</span><span className="font-mono text-xs">{formatPackaging(item.strips_per_pack, item.units_per_strip, item.units_per_pack)}</span></div>}
          {isPharmacy && item.batch_number && <div className="flex justify-between text-sm"><span>Batch:</span><span>{item.batch_number}</span></div>}
          {item.manufacturer && <div className="flex justify-between text-sm"><span>{isPharmacy ? 'Manufacturer' : 'Brand'}:</span><span>{item.manufacturer}</span></div>}
          <div className="flex justify-between text-sm"><span>Selling Price:</span><span className="font-medium">ETB {item.selling_price}</span></div>
          <div className="flex justify-between text-sm"><span>Cost Price:</span><span className="text-muted-foreground">ETB {item.purchase_price}</span></div>
          <div className="flex justify-between text-sm items-center">
            <span>Stock:</span>
            <div className="flex items-center space-x-2">
              <span className={(isLowStock(item) || isOutOfStock(item)) ? 'text-warning font-medium' : ''}>
                {(item as any).packaging ? formatStock(item.quantity, (item as any).packaging) : item.quantity}
              </span>
              {isOutOfStock(item) && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
              {isLowStock(item) && <Badge variant="destructive" className="text-xs">Low Stock</Badge>}
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Total pieces:</span>
            <span className="font-medium">{item.quantity}</span>
          </div>
          {item.branch_name && !selectedBranch && (
            <div className="flex justify-between text-sm"><span>Branch:</span><Badge variant="outline">{item.branch_name}</Badge></div>
          )}
          {isPharmacy && item.expiry_date && (
            <div className="flex justify-between text-sm">
              <span>Expiry:</span>
              <div className="flex items-center space-x-2">
                <span className={isExpired(item) ? 'text-destructive font-medium' : isExpiringSoon(item) ? 'text-warning' : ''}>
                  {new Date(item.expiry_date).toLocaleDateString()}
                </span>
                {isExpired(item) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                {!isExpired(item) && isExpiringSoon(item) && <Badge variant="secondary" className="text-xs">Expiring Soon</Badge>}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-muted-foreground">Loading {isPharmacy ? 'medicines' : 'items'}...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">{isPharmacy ? 'Inventory Management' : 'Stock Management'}</h2>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowImportDialog(true)} disabled={!hasBranches || readOnly} size="sm" variant="outline">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <Button onClick={() => setShowAddDialog(true)} disabled={!hasBranches || readOnly} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>
        </div>
        {!hasBranches && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">
              ⚠️ Please create a branch first before adding {isPharmacy ? 'medicines' : 'items'}.
            </p>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="inventory" className="text-xs sm:text-sm">{isPharmacy ? 'Medicines & Items' : 'Items'}</TabsTrigger>
          <TabsTrigger value="stock-history" className="text-xs sm:text-sm">
            <History className="h-3.5 w-3.5 mr-1" />
            Stock History
          </TabsTrigger>
          <TabsTrigger value="categories" className="text-xs sm:text-sm">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={isPharmacy ? 'Search medicines...' : 'Search items...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {isPharmacy && <SelectItem value="medicines_only">Medicines Only</SelectItem>}
                  {getUniqueCategories().map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isPharmacy && getUniqueGroups().length > 0 && (
              <div className="flex items-center space-x-2">
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Filter by group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {getUniqueGroups().map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Group by branch when "All Branches" — operates on the paginated slice */}
          {!selectedBranch && branchItems.some((i: any) => i.branch_name) ? (
            (() => {
              const grouped: Record<string, (BranchItem & { branch_name?: string })[]> = {};
              paginatedItems.forEach((i: any) => {
                const key = i.branch_name || 'Unknown Branch';
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(i);
              });
              return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([branchName, items]) => (
                <div key={branchName} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{branchName}</h3>
                    <Badge variant="secondary" className="text-xs">{items.length} {items.length === 1 ? 'item' : 'items'}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(item => renderItemCard(item))}
                  </div>
                </div>
              ));
            })()
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedItems.map(item => renderItemCard(item))}
            </div>
          )}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive>
                    {currentPage} / {totalPages}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}

          {filteredItems.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No {isPharmacy ? 'medicines' : 'items'} found.</p>
              {branchItems.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Click "Add Item" to add items from the catalog to your branch inventory.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stock-history">
          <StockEditHistory />
        </TabsContent>

        <TabsContent value="categories">
          <CategoryManagement />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AddBranchItemDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onItemAdded={handleItemAdded}
      />

      <ImportCsvDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImported={() => { refetch(); setShowImportDialog(false); }}
      />

      <EditBranchItemDialog
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
        item={editingItem}
        onItemUpdated={handleItemUpdated}
      />

      <ConfirmationDialog
        open={deleteConfirmation.open}
        onOpenChange={(open) => setDeleteConfirmation(prev => ({ ...prev, open }))}
        title={`Remove ${deleteConfirmation.itemName}?`}
        description="This will remove the item from this branch's inventory. The master catalog entry will not be affected."
        onConfirm={confirmDeleteItem}
        confirmText="Remove"
      />

      <ConfirmationDialog
        open={cascadeConfirmation.open}
        onOpenChange={(open) => setCascadeConfirmation(prev => ({ ...prev, open }))}
        title={`⚠️ Delete "${cascadeConfirmation.itemName}" and its sales history?`}
        description={`This item has ${cascadeConfirmation.saleCount} sale record${cascadeConfirmation.saleCount === 1 ? '' : 's'} linked to it. Deleting it will also permanently remove all related sales history, stock movements, batches, and transfer records for this item. This action CANNOT be undone and will affect past reports. If you only want to clear stock, cancel and use "Adjust Stock" instead.`}
        onConfirm={confirmCascadeDelete}
        confirmText="Delete Everything"
      />

      <BatchBreakdownDialog
        open={batchBreakdown.open}
        onOpenChange={(open) => setBatchBreakdown(prev => ({ ...prev, open }))}
        branchItemId={batchBreakdown.itemId}
        itemName={batchBreakdown.itemName}
      />

      <StockAdjustmentDialog
        open={!!adjustingItem}
        onOpenChange={(open) => { if (!open) setAdjustingItem(null); }}
        medicine={adjustingItem ? {
          id: adjustingItem.id,
          medicine_id: (adjustingItem as any).medicine_id,
          name: adjustingItem.name,
          stock_quantity: adjustingItem.quantity,
          purchase_price: adjustingItem.purchase_price,
          selling_price: (adjustingItem as any).selling_price,
          branch_id: adjustingItem.branch_id,
          item_type: (adjustingItem as any).item_type,
          unit_label: (adjustingItem as any).unit_label,
        } : null}
        onAdjusted={() => { setAdjustingItem(null); refetch(); }}
      />

      <MedicineInfoDialog
        open={!!infoItem}
        onOpenChange={(open) => { if (!open) setInfoItem(null); }}
        branchItemId={infoItem?.branchItemId}
        medicineId={infoItem?.medicineId}
        fallbackName={infoItem?.name}
      />
    </div>
  );
}
