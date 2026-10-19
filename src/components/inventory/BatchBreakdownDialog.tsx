import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package } from 'lucide-react';
import { getBatchesForItem, type InventoryBatch } from '@/lib/batchInventory';

interface BatchBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchItemId: string | null;
  itemName: string;
}

export default function BatchBreakdownDialog({ open, onOpenChange, branchItemId, itemName }: BatchBreakdownDialogProps) {
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && branchItemId) {
      setLoading(true);
      getBatchesForItem(branchItemId).then(data => {
        setBatches(data);
        setLoading(false);
      });
    }
  }, [open, branchItemId]);

  const isExpired = (date: string | null) => {
    if (!date) return false;
    return new Date(date) <= new Date();
  };

  const isExpiringSoon = (date: string | null) => {
    if (!date || isExpired(date)) return false;
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return new Date(date) <= thirtyDays;
  };

  const rawTotalRemaining = batches.reduce((sum, b) => sum + Number(b.remaining_quantity), 0);
  const rawTotalOriginal = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
  const fmtQty = (n: number) => {
    const rounded = Math.round(n);
    if (Math.abs(n - rounded) < 0.001) return String(rounded);
    return Number(n).toFixed(2);
  };
  const totalRemaining = fmtQty(rawTotalRemaining);
  const totalOriginal = fmtQty(rawTotalOriginal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Batch Breakdown — {itemName}
          </DialogTitle>
          <DialogDescription>
            {batches.length} batch{batches.length !== 1 ? 'es' : ''} • Total remaining: {totalRemaining} / {totalOriginal} original
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No batches found for this item.</p>
            <p className="text-sm mt-1">Items added before batch tracking was enabled won't have batch records.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch #</TableHead>
                  <TableHead className="text-right">Original Qty</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Cost Price</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map(batch => {
                  const remaining = Number(batch.remaining_quantity);
                  const original = Number(batch.quantity);
                  const depleted = remaining <= 0;

                  return (
                    <TableRow key={batch.id} className={depleted ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-xs">
                        {batch.batch_number || '—'}
                      </TableCell>
                      <TableCell className="text-right">{original}</TableCell>
                      <TableCell className="text-right font-medium">
                        {remaining}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ETB {Number(batch.purchase_price).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ETB {Number(batch.selling_price).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {batch.expiry_date ? (
                          <span className={
                            isExpired(batch.expiry_date) ? 'text-destructive font-medium' :
                            isExpiringSoon(batch.expiry_date) ? 'text-warning' : ''
                          }>
                            {new Date(batch.expiry_date).toLocaleDateString()}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(batch.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {depleted ? (
                          <Badge variant="secondary" className="text-xs">Depleted</Badge>
                        ) : isExpired(batch.expiry_date) ? (
                          <Badge variant="destructive" className="text-xs">Expired</Badge>
                        ) : isExpiringSoon(batch.expiry_date) ? (
                          <Badge className="text-xs bg-warning text-warning-foreground">Expiring Soon</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Active</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Profit summary */}
        {batches.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-muted/40 space-y-1">
            <p className="text-sm font-semibold">Batch Profit Summary</p>
            {batches.filter(b => Number(b.remaining_quantity) < Number(b.quantity)).map(batch => {
              const sold = Number(batch.quantity) - Number(batch.remaining_quantity);
              const profit = sold * (Number(batch.selling_price) - Number(batch.purchase_price));
              return (
                <div key={batch.id} className="flex justify-between text-xs">
                  <span>{batch.batch_number || 'No batch #'} — {sold} sold</span>
                  <span className={profit >= 0 ? 'text-green-600' : 'text-destructive'}>
                    ETB {profit.toFixed(2)}
                  </span>
                </div>
              );
            })}
            <div className="flex justify-between text-sm font-medium pt-1 border-t">
              <span>Total Batch Profit</span>
              <span className="text-green-600">
                ETB {batches.reduce((sum, b) => {
                  const sold = Number(b.quantity) - Number(b.remaining_quantity);
                  return sum + sold * (Number(b.selling_price) - Number(b.purchase_price));
                }, 0).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
