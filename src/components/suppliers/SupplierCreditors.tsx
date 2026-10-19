import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { DollarSign, FileText, CreditCard, Truck } from 'lucide-react';
import RecordSupplierPaymentDialog from './RecordSupplierPaymentDialog';
import SupplierLedgerDialog from './SupplierLedgerDialog';

interface SupplierDebt {
  id: string;
  supplier_id: string;
  total_debt: number;
  last_updated: string;
  supplier_name: string;
  supplier_phone?: string;
}

export default function SupplierCreditors() {
  const [creditors, setCreditors] = useState<SupplierDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: ownerBranchIds } = useOwnerBranchIds();

  const [paymentDialog, setPaymentDialog] = useState<{ open: boolean; supplierId: string; supplierName: string; debt: number }>({ open: false, supplierId: '', supplierName: '', debt: 0 });
  const [ledgerDialog, setLedgerDialog] = useState<{ open: boolean; supplierId: string; supplierName: string }>({ open: false, supplierId: '', supplierName: '' });

  useEffect(() => { fetchCreditors(); }, [selectedBranch, profile?.id, ownerBranchIds.join(',')]);

  const fetchCreditors = async () => {
    setLoading(true);
    try {
      let query = supabase.from('supplier_debts').select('*').gt('total_debt', 0);
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (profile?.role === 'owner') {
        if (ownerBranchIds.length === 0) { setCreditors([]); setLoading(false); return; }
        query = query.in('branch_id', ownerBranchIds);
      } else if (profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }
      const { data, error } = await query;
      if (error) throw error;

      // Fetch supplier names
      const supplierIds = (data || []).map(d => d.supplier_id);
      if (supplierIds.length === 0) { setCreditors([]); setLoading(false); return; }
      const { data: suppliers } = await supabase.from('suppliers').select('id, name, phone').in('id', supplierIds);
      const supplierMap: Record<string, any> = {};
      for (const s of suppliers || []) supplierMap[s.id] = s;

      setCreditors((data || []).map(d => ({
        ...d,
        supplier_name: supplierMap[d.supplier_id]?.name || 'Unknown',
        supplier_phone: supplierMap[d.supplier_id]?.phone,
      })).sort((a, b) => b.total_debt - a.total_debt));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch creditors', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const totalDebt = creditors.reduce((s, c) => s + Number(c.total_debt), 0);

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading creditors...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm text-muted-foreground">Total Supplier Debt</p>
            <p className="text-2xl font-bold text-destructive">ETB {totalDebt.toFixed(2)}</p>
          </div>
          <Badge variant="outline" className="ml-auto">{creditors.length} supplier{creditors.length !== 1 ? 's' : ''}</Badge>
        </CardContent>
      </Card>

      {creditors.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No outstanding supplier debts.</p>
        </div>
      ) : (
        <ScrollArea className="w-full rounded-md border">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Supplier</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Outstanding Debt</TableHead>
                <TableHead className="text-right">Last Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditors.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.supplier_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.supplier_phone || '—'}</TableCell>
                  <TableCell className="text-right font-bold text-destructive">ETB {Number(c.total_debt).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{new Date(c.last_updated).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setPaymentDialog({ open: true, supplierId: c.supplier_id, supplierName: c.supplier_name, debt: Number(c.total_debt) })}>
                        <CreditCard className="h-3 w-3 mr-1" /> Pay
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setLedgerDialog({ open: true, supplierId: c.supplier_id, supplierName: c.supplier_name })}>
                        <FileText className="h-3 w-3 mr-1" /> Ledger
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      <RecordSupplierPaymentDialog
        open={paymentDialog.open}
        onOpenChange={(o) => setPaymentDialog(prev => ({ ...prev, open: o }))}
        supplierId={paymentDialog.supplierId}
        supplierName={paymentDialog.supplierName}
        currentDebt={paymentDialog.debt}
        onPaymentRecorded={() => { setPaymentDialog(prev => ({ ...prev, open: false })); fetchCreditors(); }}
      />

      <SupplierLedgerDialog
        open={ledgerDialog.open}
        onOpenChange={(o) => setLedgerDialog(prev => ({ ...prev, open: o }))}
        supplierId={ledgerDialog.supplierId}
        supplierName={ledgerDialog.supplierName}
      />
    </div>
  );
}
