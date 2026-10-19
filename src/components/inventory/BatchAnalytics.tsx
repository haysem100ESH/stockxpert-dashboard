import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, AlertTriangle, TrendingUp, Package } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface BatchProfit {
  batchId: string;
  batchNumber: string | null;
  medicineName: string;
  originalQty: number;
  soldQty: number;
  remainingQty: number;
  purchasePrice: number;
  sellingPrice: number;
  profit: number;
  expiryDate: string | null;
  isExpired: boolean;
}

export default function BatchAnalytics() {
  const [batches, setBatches] = useState<BatchProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchBatchData();
  }, [selectedBranch, profile]);

  const fetchBatchData = async () => {
    if (!profile) return;
    setLoading(true);

    try {
      let branchIds: string[] = [];
      if (selectedBranch) {
        branchIds = [selectedBranch];
      } else if (profile.role === 'owner' && profile.id) {
        const { data: branches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        branchIds = (branches || []).map((b: any) => b.id);
      } else if (profile.branch_id) {
        branchIds = [profile.branch_id];
      }

      if (branchIds.length === 0) {
        setBatches([]);
        setLoading(false);
        return;
      }

      const { data: batchData } = await supabase
        .from('inventory_batches')
        .select('id, batch_number, medicine_id, quantity, remaining_quantity, purchase_price, selling_price, expiry_date')
        .in('branch_id', branchIds)
        .order('created_at', { ascending: false });

      if (!batchData || batchData.length === 0) {
        setBatches([]);
        setLoading(false);
        return;
      }

      // Fetch medicine names (chunked to 20 ids/req for URL safety).
      const medIds = [...new Set(batchData.map((b: any) => b.medicine_id).filter(Boolean))] as string[];
      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      console.log(`[Supabase batching] medicines by id (BatchAnalytics): ${Math.ceil(medIds.length / 20)} batches for ${medIds.length} ids`);
      const { data: meds } = await chunkedInPartial<any>(medIds, (chunk) =>
        supabase
          .from('medicines')
          .select('id, name')
          .in('id', chunk)
      , 20);

      const medMap: Record<string, string> = {};
      meds.forEach((m: any) => { medMap[m.id] = m.name; });

      const today = new Date().toISOString().split('T')[0];

      const profits: BatchProfit[] = batchData.map((b: any) => {
        const soldQty = Number(b.quantity) - Number(b.remaining_quantity);
        const profit = soldQty * (Number(b.selling_price) - Number(b.purchase_price));
        return {
          batchId: b.id,
          batchNumber: b.batch_number,
          medicineName: medMap[b.medicine_id] || 'Unknown',
          originalQty: Number(b.quantity),
          soldQty,
          remainingQty: Number(b.remaining_quantity),
          purchasePrice: Number(b.purchase_price),
          sellingPrice: Number(b.selling_price),
          profit,
          expiryDate: b.expiry_date,
          isExpired: b.expiry_date ? b.expiry_date <= today : false,
        };
      });

      setBatches(profits);
    } catch (error) {
      console.error('Error fetching batch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalProfit = batches.reduce((sum, b) => sum + b.profit, 0);
  const bestBatches = [...batches].filter(b => b.soldQty > 0).sort((a, b) => b.profit - a.profit).slice(0, 10);
  const expiryLossBatches = batches.filter(b => b.isExpired && b.remainingQty > 0);
  const expiryLoss = expiryLossBatches.reduce((sum, b) => sum + (b.remainingQty * b.purchasePrice), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-muted-foreground">Loading batch analytics...</span>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p>No batch data available yet.</p>
        <p className="text-sm mt-1">Batch analytics will appear once items are added with the batch tracking system.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Batch Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
              ETB {totalProfit.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Batches</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{batches.filter(b => b.remainingQty > 0).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Expiry Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">ETB {expiryLoss.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{expiryLossBatches.length} expired batches with remaining stock</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="best" className="space-y-4">
        <TabsList>
          <TabsTrigger value="best">
            <TrendingUp className="h-4 w-4 mr-1" />
            Best Batches
          </TabsTrigger>
          <TabsTrigger value="expiry">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Expiry Loss
          </TabsTrigger>
          <TabsTrigger value="all">
            <BarChart3 className="h-4 w-4 mr-1" />
            All Batches
          </TabsTrigger>
        </TabsList>

        <TabsContent value="best">
          <Card>
            <CardHeader>
              <CardTitle>Top Performing Batches</CardTitle>
              <CardDescription>Batches with highest profit</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Batch #</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bestBatches.map(b => (
                      <TableRow key={b.batchId}>
                        <TableCell className="font-medium">{b.medicineName}</TableCell>
                        <TableCell className="font-mono text-xs">{b.batchNumber || '—'}</TableCell>
                        <TableCell className="text-right">{Number.isInteger(b.soldQty) ? b.soldQty : Number(b.soldQty).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium text-primary">ETB {b.profit.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expiry">
          <Card>
            <CardHeader>
              <CardTitle>Expiry Loss Report</CardTitle>
              <CardDescription>Expired batches with unsold stock — potential loss</CardDescription>
            </CardHeader>
            <CardContent>
              {expiryLossBatches.length === 0 ? (
                <p className="text-center py-6 text-muted-foreground">No expired batches with remaining stock 🎉</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Batch #</TableHead>
                        <TableHead>Expired</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="text-right">Loss</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expiryLossBatches.map(b => (
                        <TableRow key={b.batchId}>
                          <TableCell className="font-medium">{b.medicineName}</TableCell>
                          <TableCell className="font-mono text-xs">{b.batchNumber || '—'}</TableCell>
                          <TableCell className="text-destructive">
                            {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : '—'}
                          </TableCell>
                          <TableCell className="text-right">{b.remainingQty}</TableCell>
                          <TableCell className="text-right font-medium text-destructive">
                            ETB {(b.remainingQty * b.purchasePrice).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Batches</CardTitle>
              <CardDescription>Complete batch inventory with profit data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Batch #</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Sell</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.slice(0, 50).map(b => (
                      <TableRow key={b.batchId} className={b.remainingQty <= 0 ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{b.medicineName}</TableCell>
                        <TableCell className="font-mono text-xs">{b.batchNumber || '—'}</TableCell>
                        <TableCell className="text-right">{b.originalQty}</TableCell>
                        <TableCell className="text-right">{b.remainingQty}</TableCell>
                        <TableCell className="text-right text-muted-foreground">ETB {b.purchasePrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right">ETB {b.sellingPrice.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-medium ${b.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                          ETB {b.profit.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {b.remainingQty <= 0 ? (
                            <Badge variant="secondary" className="text-xs">Depleted</Badge>
                          ) : b.isExpired ? (
                            <Badge variant="destructive" className="text-xs">Expired</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">Active</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
