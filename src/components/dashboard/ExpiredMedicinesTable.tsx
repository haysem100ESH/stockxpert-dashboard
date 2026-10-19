import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';

interface ExpiredMedicine {
  id: string;
  name: string;
  batch_number?: string;
  expiry_date: string;
  stock_quantity: number;
}

export default function ExpiredMedicinesTable() {
  const [expiredMedicines, setExpiredMedicines] = useState<ExpiredMedicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [medicineToDelete, setMedicineToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: cachedOwnerBranchIds } = useOwnerBranchIds();

  useEffect(() => {
    fetchExpiredMedicines();
  }, [selectedBranch, cachedOwnerBranchIds]);

  const fetchExpiredMedicines = async () => {
    try {
      // Use cached owner branches (avoids duplicate network calls).
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        ownerBranchIds = cachedOwnerBranchIds;
      }

      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setExpiredMedicines([]);
        setLoading(false);
        return;
      }

      // Query branch_items for expired items
      let query = supabase
        .from('branch_items')
        .select('id, quantity, expiry_date, medicines!inner(name, batch_number)')
        .not('expiry_date', 'is', null)
        .lt('expiry_date', new Date().toISOString().split('T')[0]);

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query.order('expiry_date', { ascending: true });

      if (error) throw error;
      
      const mapped = (data || []).map((item: any) => ({
        id: item.id,
        name: item.medicines?.name || 'Unknown',
        batch_number: item.medicines?.batch_number,
        expiry_date: item.expiry_date,
        stock_quantity: item.quantity,
      }));
      
      setExpiredMedicines(mapped);
    } catch (error) {
      console.error('Error fetching expired medicines:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMedicine = (medicineId: string) => {
    setMedicineToDelete(medicineId);
    setDeleteConfirm(true);
  };

  const confirmDeleteMedicine = async () => {
    if (!medicineToDelete) return;

    setDeleteConfirm(false);

    try {
      // Set quantity to 0 on branch_items
      const { error } = await supabase
        .from('branch_items')
        .update({ quantity: 0 })
        .eq('id', medicineToDelete);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Expired item stock set to 0 successfully"
      });

      setExpiredMedicines(expiredMedicines.filter(item => item.id !== medicineToDelete));
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove expired item",
        variant: "destructive"
      });
    } finally {
      setMedicineToDelete(null);
    }
  };

  if (loading) {
    return <div>Loading expired items...</div>;
  }

  if (expiredMedicines.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span>Expired Items</span>
          </CardTitle>
          <CardDescription>
            {expiredMedicines.length} items have expired and should be removed from inventory
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>Batch Number</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiredMedicines.map((medicine) => (
                <TableRow key={medicine.id}>
                  <TableCell className="font-medium">{medicine.name}</TableCell>
                  <TableCell>{medicine.batch_number || '-'}</TableCell>
                  <TableCell className="text-destructive">
                    {new Date(medicine.expiry_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{medicine.stock_quantity}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteMedicine(medicine.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title="Remove Expired Item"
        description="Are you sure you want to set this expired item's stock to 0? This action cannot be undone."
        onConfirm={confirmDeleteMedicine}
        confirmText="Remove"
      />
    </>
  );
}
