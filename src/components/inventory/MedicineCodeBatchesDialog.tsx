/**
 * MedicineCodeBatchesDialog
 * Level 3 drill-down: shows all batches for a specific medicine in the
 * current branch scope, with expiry-status colour coding.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { AlertTriangle, CircleAlert, CheckCircle2 } from 'lucide-react';
import { classifyExpiry, type BatchRow } from '@/hooks/useMedicineCodeAnalytics';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  medicineName: string;
  batches: BatchRow[];
  globalAlertDays: number;
}

export default function MedicineCodeBatchesDialog({
  open, onOpenChange, medicineName, batches, globalAlertDays,
}: Props) {
  const sorted = [...batches].sort((a, b) => {
    if (!a.expiry_date) return 1;
    if (!b.expiry_date) return -1;
    return a.expiry_date.localeCompare(b.expiry_date);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Batches — {medicineName}</DialogTitle>
          <DialogDescription>
            All batches in the current branch scope. Expiry status uses each batch's
            override or the global threshold ({globalAlertDays} days).
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No batches found.</div>
        ) : (
          <ScrollArea className="flex-1 max-h-[60vh] border rounded-md">
            <div className="divide-y">
              {sorted.map((b) => {
                const alertDays = b.expiry_alert_days ?? globalAlertDays;
                const status = classifyExpiry(b.expiry_date, alertDays);
                const badge =
                  status === 'expired'
                    ? <Badge variant="destructive" className="gap-1"><CircleAlert className="h-3 w-3" />Expired</Badge>
                    : status === 'expiring'
                      ? <Badge className="gap-1 bg-orange-500 hover:bg-orange-500/90 text-white"><AlertTriangle className="h-3 w-3" />Expiring Soon</Badge>
                      : status === 'normal'
                        ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" />Normal</Badge>
                        : <Badge variant="outline">No expiry</Badge>;
                return (
                  <div key={b.id} className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm items-center">
                    <div className="font-mono text-xs truncate" title={b.batch_number || ''}>
                      {b.batch_number || '—'}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Remaining</div>
                      <div className="font-medium">{Number(b.remaining_quantity) || 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Expiry</div>
                      <div>{b.expiry_date ? format(new Date(b.expiry_date), 'dd MMM yyyy') : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Purchase</div>
                      <div>{b.purchase_price != null ? Number(b.purchase_price).toFixed(2) : '—'}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Selling</div>
                        <div>{b.selling_price != null ? Number(b.selling_price).toFixed(2) : '—'}</div>
                      </div>
                      {badge}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
