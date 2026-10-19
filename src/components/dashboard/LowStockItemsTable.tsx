import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { formatStock, defaultPackaging, type Packaging } from '@/lib/packaging';

interface LowStockItem {
  id: string;
  name: string;
  stock_quantity: number;
  minimum_stock_level: number;
  packaging?: Packaging | null;
}

export default function LowStockItemsTable() {
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: cachedOwnerBranchIds } = useOwnerBranchIds();

  useEffect(() => {
    fetchLowStockItems();
  }, [selectedBranch, cachedOwnerBranchIds]);

  const fetchLowStockItems = async () => {
    try {
      // Use cached owner branches.
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        ownerBranchIds = cachedOwnerBranchIds;
      }

      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setLowStockItems([]);
        setLoading(false);
        return;
      }

      // Query branch_items joined with medicines for minimum_stock_level
      let query = supabase
        .from('branch_items')
        .select('id, quantity, medicine_id, medicines!inner(name, minimum_stock_level)')
        .gt('quantity', 0);

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query.order('quantity', { ascending: true });

      if (error) throw error;

      const filtered = (data || []).filter(
        (item: any) => item.quantity <= (item.medicines?.minimum_stock_level || 0)
      );

      // Fetch packaging chunked (max 20 ids/request) to avoid URL-length 400s.
      const medIds = [...new Set(filtered.map((i: any) => i.medicine_id).filter(Boolean))] as string[];
      const packMap: Record<string, Packaging> = {};
      if (medIds.length > 0) {
        const { chunkedInPartial } = await import('@/lib/supabaseBatch');
        console.log(`[Supabase batching] medicine_packaging by medicine_id (LowStockItemsTable): ${Math.ceil(medIds.length / 20)} batches for ${medIds.length} ids`);
        const { data: packs } = await chunkedInPartial<any>(medIds, (chunk) =>
          (supabase as any)
            .from('medicine_packaging')
            .select('*')
            .in('medicine_id', chunk)
        , 20);
        packs.forEach((p: any) => { packMap[p.medicine_id] = p as Packaging; });
      }

      const lowStock = filtered.map((item: any) => ({
        id: item.id,
        name: item.medicines?.name || 'Unknown',
        stock_quantity: item.quantity,
        minimum_stock_level: item.medicines?.minimum_stock_level || 0,
        packaging: packMap[item.medicine_id] || null,
      }));

      setLowStockItems(lowStock);
    } catch (error) {
      console.error('Error fetching low stock items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading low stock items...</div>;
  }

  if (lowStockItems.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Package className="h-5 w-5 text-warning" />
          <span>Low Stock Items</span>
        </CardTitle>
        <CardDescription>
          {lowStockItems.length} items are running low on stock and need restocking
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table className="min-w-[500px]">
          <TableHeader>
            <TableRow>
              <TableHead>Item Name</TableHead>
              <TableHead>Available Quantity</TableHead>
              <TableHead>Threshold Limit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lowStockItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-warning">
                    {item.packaging ? formatStock(item.stock_quantity, item.packaging) : item.stock_quantity}
                  </Badge>
                </TableCell>
                <TableCell>{item.minimum_stock_level}</TableCell>
                <TableCell>
                  <Badge variant="destructive">
                    Low Stock
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
