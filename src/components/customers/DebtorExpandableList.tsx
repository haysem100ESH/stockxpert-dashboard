import { useState } from 'react';
import { ChevronDown, ChevronRight, CreditCard, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

interface Debtor {
  id: string;
  name: string;
  phone?: string | null;
  totalDebt: number;
  lastPurchaseDate?: string;
  credit_score: number;
  max_credit_limit: number;
}

interface CreditItem {
  medicineName: string;
  quantity: number;
  unitLabel: string;
  itemType: string;
  unitPrice: number;
  totalPrice: number;
  createdAt: string;
}

interface DebtorExpandableListProps {
  debtors: Debtor[];
  loading: boolean;
  onRecordPayment: (debtor: Debtor) => void;
  onViewLedger?: (debtor: Debtor) => void;
}

function formatQuantity(quantity: number, unitLabel: string, itemType: string): string {
  if (itemType === 'measurable') {
    return `${Number(quantity).toFixed(2)} ${unitLabel}`;
  }
  return `${Math.round(quantity)} ${unitLabel}`;
}

function ExpandedCreditItems({ customerId }: { customerId: string }) {
  const [items, setItems] = useState<CreditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState(false);
  const { toast } = useToast();

  if (!fetched) {
    setFetched(true);
    (async () => {
      try {
        // Fetch unpaid/partially paid sales for this customer
        const { data: salesData, error: salesErr } = await (supabase as any)
          .from('sales')
          .select('id, created_at')
          .eq('customer_id', customerId)
          .neq('payment_status', 'paid')
          .order('created_at', { ascending: false });

        if (salesErr) throw salesErr;

        if (!salesData || salesData.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }

        const saleIds = salesData.map((s: any) => s.id);
        const saleMap = new Map(salesData.map((s: any) => [s.id, s.created_at]));

        // Fetch sale items for these sales
        const { data: saleItemsData, error: itemsErr } = await (supabase as any)
          .from('sale_items')
          .select('sale_id, medicine_id, quantity, unit_price, total_price, strip_quantity, pack_quantity, stripes_sold, sale_type')
          .in('sale_id', saleIds);

        if (itemsErr) throw itemsErr;

        if (!saleItemsData || saleItemsData.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }

        // Fetch medicine details (chunked to 20 ids/req for URL safety).
        const medicineIds = [...new Set(saleItemsData.map((si: any) => si.medicine_id).filter((id: any) => id !== null && id !== undefined))] as string[];
        let medsData: any[] = [];
        if (medicineIds.length > 0) {
          const { chunkedInPartial } = await import('@/lib/supabaseBatch');
          console.log(`[Supabase batching] medicines by id (DebtorExpandableList): ${Math.ceil(medicineIds.length / 20)} batches for ${medicineIds.length} ids`);
          const { data } = await chunkedInPartial<any>(medicineIds, (chunk) =>
            (supabase as any)
              .from('medicines')
              .select('id, name, unit_label, item_type')
              .in('id', chunk)
          , 20);
          medsData = data;
        }

        const medMap = new Map((medsData || []).map((m: any) => [m.id, m]));

        const creditItems: CreditItem[] = saleItemsData.map((si: any) => {
          const med: any = medMap.get(si.medicine_id);
          // Determine the correct quantity based on sale_type
          let displayQuantity = Number(si.quantity);
          let displayUnitLabel = med?.unit_label || 'pcs';

          // For measurable items, always use unit_label from medicines (KG, L, etc.)
          if (med?.item_type === 'measurable') {
            displayQuantity = Number(si.quantity);
            displayUnitLabel = (med?.unit_label || 'unit').toUpperCase();
          } else if (si.sale_type === 'by_stripe') {
            const directStripQty = Number(si.strip_quantity || 0);
            const legacyStripesSold = Number(si.stripes_sold || 0);
            const decodedLegacyQty = legacyStripesSold >= 1000 ? legacyStripesSold / 1000 : legacyStripesSold;
            const resolvedStripQty = directStripQty > 0 ? directStripQty : decodedLegacyQty;

            displayQuantity = resolvedStripQty > 0 ? resolvedStripQty : Number(si.quantity || 0);
            const baseUnit = med?.unit_label || 'strip';
            displayUnitLabel = `${baseUnit}${Math.abs(displayQuantity) === 1 ? '' : 's'}`;
          } else if (si.sale_type === 'full_pack') {
            const packQty = Number(si.pack_quantity || 0);
            displayQuantity = packQty > 0 ? packQty : Number(si.quantity || 0);
            displayUnitLabel = Math.abs(displayQuantity) === 1 ? 'pack' : 'packs';
          }
          return {
            medicineName: med?.name || 'Unknown Item',
            quantity: displayQuantity,
            unitLabel: displayUnitLabel,
            itemType: med?.item_type || 'full_pcs',
            unitPrice: Number(si.unit_price),
            totalPrice: Number(si.total_price),
            createdAt: saleMap.get(si.sale_id) || '',
          };
        });

        // Sort by newest first
        creditItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        setItems(creditItems);
      } catch {
        toast({ title: 'Error', description: 'Failed to load credit items', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading credit items...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No unpaid credit items found
      </div>
    );
  }

  return (
    <div className="px-2 pb-3">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="text-xs font-semibold">Item Name</TableHead>
            <TableHead className="text-xs font-semibold">Quantity</TableHead>
            <TableHead className="text-xs font-semibold">Unit Price</TableHead>
            <TableHead className="text-xs font-semibold">Total Price</TableHead>
            <TableHead className="text-xs font-semibold">Transaction Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={idx} className="hover:bg-muted/20">
              <TableCell className="text-sm font-medium">{item.medicineName}</TableCell>
              <TableCell className="text-sm">{formatQuantity(item.quantity, item.unitLabel, item.itemType)}</TableCell>
              <TableCell className="text-sm">ETB {item.unitPrice.toFixed(2)}</TableCell>
              <TableCell className="text-sm font-medium">ETB {item.totalPrice.toFixed(2)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                }) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DebtorExpandableList({ debtors, loading, onRecordPayment, onViewLedger }: DebtorExpandableListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = debtors.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search debtors..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10"></TableHead>
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="font-semibold">Phone</TableHead>
              <TableHead className="font-semibold">Outstanding</TableHead>
              <TableHead className="font-semibold">Last Purchase</TableHead>
              <TableHead className="font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, ci) => (
                    <TableCell key={ci}>
                      <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No outstanding debts 🎉
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(debtor => {
                const isExpanded = expandedIds.has(debtor.id);
                return (
                  <TableRow key={debtor.id} className="group">
                    <TableCell colSpan={6} className="p-0">
                      <div>
                        {/* Main row */}
                        <div className="flex items-center gap-0 px-4 py-3">
                          <button
                            onClick={() => toggleExpand(debtor.id)}
                            className="mr-2 p-1 rounded hover:bg-muted transition-colors flex-shrink-0"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                          <div className="grid grid-cols-5 gap-4 flex-1 items-center min-w-0">
                            <span className="font-medium truncate">{debtor.name}</span>
                            <span className="text-sm text-muted-foreground">{debtor.phone || '—'}</span>
                            <span className="text-destructive font-semibold whitespace-nowrap">
                              ETB {debtor.totalDebt.toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {debtor.lastPurchaseDate
                                ? new Date(debtor.lastPurchaseDate).toLocaleDateString()
                                : '—'}
                            </span>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => onRecordPayment(debtor)}>
                                <CreditCard className="h-3 w-3 mr-1" /> Pay
                              </Button>
                              {onViewLedger && (
                                <Button size="sm" variant="outline" onClick={() => onViewLedger(debtor)}>
                                  <FileText className="h-3 w-3 mr-1" /> Ledger
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="bg-muted/10 border-t border-dashed mx-4 mb-2 rounded-b-md">
                            <ExpandedCreditItems customerId={debtor.id} />
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
