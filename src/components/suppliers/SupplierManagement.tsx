import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, Search, Edit, Trash2, Truck, Phone, Mail, MapPin, User, MoreVertical, ShoppingCart, FileText, CreditCard, Brain } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddSupplierDialog from './AddSupplierDialog';
import EditSupplierDialog from './EditSupplierDialog';
import RecordPurchaseDialog from './RecordPurchaseDialog';
import RecordSupplierPaymentDialog from './RecordSupplierPaymentDialog';
import SupplierLedgerDialog from './SupplierLedgerDialog';
import SupplierCreditors from './SupplierCreditors';
import SupplierAnalytics from './SupplierAnalytics';
import SupplierIntelligenceDashboard from './SupplierIntelligenceDashboard';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useReadOnly } from '@/hooks/useReadOnly';

interface Supplier {
  id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  created_at: string;
}

export default function SupplierManagement() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
  const [paginatedSuppliers, setPaginatedSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; supplierId: string; supplierName: string }>({ open: false, supplierId: '', supplierName: '' });
  const [purchaseDialog, setPurchaseDialog] = useState<{ open: boolean; supplierId: string; supplierName: string }>({ open: false, supplierId: '', supplierName: '' });
  const [paymentDialog, setPaymentDialog] = useState<{ open: boolean; supplierId: string; supplierName: string; debt: number }>({ open: false, supplierId: '', supplierName: '', debt: 0 });
  const [ledgerDialog, setLedgerDialog] = useState<{ open: boolean; supplierId: string; supplierName: string }>({ open: false, supplierId: '', supplierName: '' });
  const [supplierDebts, setSupplierDebts] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const { profile } = useAuth();
  const readOnly = useReadOnly();
  const { selectedBranch } = useBranchContext();
  const { branchIds: ownerBranchIds } = useOwnerBranchIds();
  
  const itemsPerPage = 15;

  useEffect(() => { fetchSuppliers(); }, [selectedBranch, profile?.id, ownerBranchIds.join(',')]);

  useEffect(() => {
    const filtered = suppliers.filter(supplier =>
      supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSuppliers(filtered);
    setCurrentPage(1);
  }, [suppliers, searchTerm]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    setPaginatedSuppliers(filteredSuppliers.slice(startIndex, startIndex + itemsPerPage));
  }, [filteredSuppliers, currentPage]);

  const fetchSuppliers = async () => {
    try {
      let query = supabase.from('suppliers').select('*').order('name');
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (profile?.role === 'owner') {
        if (ownerBranchIds.length === 0) { setSuppliers([]); setLoading(false); return; }
        query = query.in('branch_id', ownerBranchIds);
      } else if (profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }
      const { data, error } = await query;
      if (error) throw error;
      setSuppliers(data || []);

      // Fetch debts
      const { data: debts } = await supabase.from('supplier_debts').select('supplier_id, total_debt');
      const debtMap: Record<string, number> = {};
      for (const d of debts || []) debtMap[d.supplier_id] = Number(d.total_debt);
      setSupplierDebts(debtMap);
    } catch {
      toast({ title: "Error", description: "Failed to fetch suppliers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierAdded = () => { fetchSuppliers(); setShowAddDialog(false); };
  const handleSupplierUpdated = () => { fetchSuppliers(); setShowEditDialog(false); setSelectedSupplier(null); };
  const handleEditSupplier = (supplier: Supplier) => { setSelectedSupplier(supplier); setShowEditDialog(true); };

  const handleDeleteSupplier = (supplierId: string, supplierName: string) => {
    if (!profile || profile.role !== 'owner') {
      toast({ title: "Error", description: "Only owners can delete suppliers", variant: "destructive" });
      return;
    }
    setDeleteConfirm({ open: true, supplierId, supplierName });
  };

  const confirmDeleteSupplier = async () => {
    setDeleteConfirm(prev => ({ ...prev, open: false }));
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', deleteConfirm.supplierId);
      if (error) throw error;
      toast({ title: "Success", description: "Supplier deleted successfully" });
      fetchSuppliers();
    } catch {
      toast({ title: "Error", description: "Failed to delete supplier", variant: "destructive" });
    }
  };

  const totalPages = Math.ceil(filteredSuppliers.length / itemsPerPage);

  if (loading) return <div>Loading suppliers...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Supplier Management</h2>
      </div>

      <Tabs defaultValue="suppliers" className="w-full">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="creditors">Creditors</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-1">
            <Brain className="h-4 w-4" />
            Intelligence
          </TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-4 mt-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search suppliers..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
            </div>
            {profile?.role === 'owner' && !readOnly && (
              <Button onClick={() => setShowAddDialog(true)}><Plus className="h-4 w-4 mr-2" />Add Supplier</Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedSuppliers.map((supplier) => (
              <Card key={supplier.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <Truck className="h-5 w-5 text-primary" />
                      <div>
                        <CardTitle className="text-lg">{supplier.name}</CardTitle>
                        {supplier.contact_person && (
                          <CardDescription className="flex items-center space-x-1 mt-1">
                            <User className="h-3 w-3" /><span>{supplier.contact_person}</span>
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                       <DropdownMenuContent align="end">
                        {!readOnly && (
                          <DropdownMenuItem onClick={() => setPurchaseDialog({ open: true, supplierId: supplier.id, supplierName: supplier.name })}>
                            <ShoppingCart className="h-4 w-4 mr-2" /> Record Purchase
                          </DropdownMenuItem>
                        )}
                        {!readOnly && (supplierDebts[supplier.id] || 0) > 0 && (
                          <DropdownMenuItem onClick={() => setPaymentDialog({ open: true, supplierId: supplier.id, supplierName: supplier.name, debt: supplierDebts[supplier.id] || 0 })}>
                            <CreditCard className="h-4 w-4 mr-2" /> Record Payment
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setLedgerDialog({ open: true, supplierId: supplier.id, supplierName: supplier.name })}>
                          <FileText className="h-4 w-4 mr-2" /> View Ledger
                        </DropdownMenuItem>
                        {!readOnly && (
                          <DropdownMenuItem onClick={() => handleEditSupplier(supplier)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                        )}
                        {!readOnly && profile?.role === 'owner' && (
                          <DropdownMenuItem onClick={() => handleDeleteSupplier(supplier.id, supplier.name)} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {supplier.phone && (
                      <div className="flex items-center space-x-2 text-sm"><Phone className="h-4 w-4 text-muted-foreground" /><span>{supplier.phone}</span></div>
                    )}
                    {supplier.email && (
                      <div className="flex items-center space-x-2 text-sm"><Mail className="h-4 w-4 text-muted-foreground" /><span>{supplier.email}</span></div>
                    )}
                    {supplier.address && (
                      <div className="flex items-start space-x-2 text-sm"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5" /><span className="text-wrap">{supplier.address}</span></div>
                    )}
                    {(supplierDebts[supplier.id] || 0) > 0 && (
                      <Badge variant="destructive" className="mt-2">Debt: ETB {(supplierDebts[supplier.id] || 0).toFixed(2)}</Badge>
                    )}
                    <div className="text-xs text-muted-foreground">Added: {new Date(supplier.created_at).toLocaleDateString()}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredSuppliers.length === 0 && (
            <div className="text-center py-8"><Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" /><p className="text-muted-foreground">No suppliers found.</p></div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); if (currentPage > 1) setCurrentPage(currentPage - 1); }} className={currentPage === 1 ? "pointer-events-none opacity-50" : ""} />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink href="#" onClick={(e) => { e.preventDefault(); setCurrentPage(page); }} isActive={currentPage === page}>{page}</PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext href="#" onClick={(e) => { e.preventDefault(); if (currentPage < totalPages) setCurrentPage(currentPage + 1); }} className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

          <div className="text-center text-sm text-muted-foreground">
            Showing {paginatedSuppliers.length} of {filteredSuppliers.length} suppliers
          </div>
        </TabsContent>

        <TabsContent value="creditors" className="mt-4">
          <SupplierCreditors />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <SupplierAnalytics />
        </TabsContent>

        <TabsContent value="intelligence" className="mt-4">
          <SupplierIntelligenceDashboard />
        </TabsContent>
      </Tabs>

      <AddSupplierDialog open={showAddDialog} onOpenChange={setShowAddDialog} onSupplierAdded={handleSupplierAdded} />
      <EditSupplierDialog open={showEditDialog} onOpenChange={setShowEditDialog} supplier={selectedSupplier} onSupplierUpdated={handleSupplierUpdated} />
      
      <RecordPurchaseDialog
        open={purchaseDialog.open}
        onOpenChange={(o) => setPurchaseDialog(prev => ({ ...prev, open: o }))}
        supplierId={purchaseDialog.supplierId}
        supplierName={purchaseDialog.supplierName}
        onPurchaseRecorded={() => { setPurchaseDialog(prev => ({ ...prev, open: false })); fetchSuppliers(); }}
      />

      <RecordSupplierPaymentDialog
        open={paymentDialog.open}
        onOpenChange={(o) => setPaymentDialog(prev => ({ ...prev, open: o }))}
        supplierId={paymentDialog.supplierId}
        supplierName={paymentDialog.supplierName}
        currentDebt={paymentDialog.debt}
        onPaymentRecorded={() => { setPaymentDialog(prev => ({ ...prev, open: false })); fetchSuppliers(); }}
      />

      <SupplierLedgerDialog
        open={ledgerDialog.open}
        onOpenChange={(o) => setLedgerDialog(prev => ({ ...prev, open: o }))}
        supplierId={ledgerDialog.supplierId}
        supplierName={ledgerDialog.supplierName}
      />

      <ConfirmationDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(prev => ({ ...prev, open }))}
        title="Delete Supplier"
        description={`Are you sure you want to delete "${deleteConfirm.supplierName}"? This action cannot be undone.`}
        onConfirm={confirmDeleteSupplier}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
