import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/db';
import { getCreditLimit } from '@/hooks/useCreditScore';
import CreditScoreBadge from './CreditScoreBadge';
import DebtProgressBar from './DebtProgressBar';
import CreditHistoryTab from './CreditHistoryTab';

interface CustomerDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

interface SaleRecord {
  id: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  payment_method: string;
  created_at: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

export default function CustomerDetailDialog({ open, onOpenChange, customerId, customerName }: CustomerDetailDialogProps) {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditScore, setCreditScore] = useState(50);
  const [currentDebt, setCurrentDebt] = useState(0);
  const [maxCreditLimit, setMaxCreditLimit] = useState(5000);

  useEffect(() => {
    if (open && customerId) {
      fetchData();
    }
  }, [open, customerId]);

  const fetchData = async () => {
    setLoading(true);
    const [salesRes, paymentsRes, customerRes, latestCreditLog] = await Promise.all([
      supabase.from('sales').select('id, total_amount, amount_paid, payment_status, payment_method, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('customer_payments').select('id, amount, payment_method, notes, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('customers').select('credit_score, max_credit_limit').eq('id', customerId).single(),
      (supabase as any).from('credit_logs').select('new_score').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const salesData = (salesRes.data as any[]) || [];
    setSales(salesData);
    setPayments(paymentsRes.data || []);

    const logScore = latestCreditLog?.data?.new_score;
    const tableScore = (customerRes as any).data?.credit_score;
    const score = logScore ?? tableScore ?? 50;
    setCreditScore(score);
    setMaxCreditLimit((customerRes as any).data?.max_credit_limit ?? getCreditLimit(score));

    const totalPurchases = salesData.reduce((s: number, r: any) => s + Number(r.total_amount), 0);
    const paidAtSale = salesData.reduce((s: number, r: any) => s + Number(r.amount_paid || 0), 0);
    const totalPayments = (paymentsRes.data || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    setCurrentDebt(Math.max(0, totalPurchases - paidAtSale - totalPayments));

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[600px] max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">{customerName} — History</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">Purchase and payment history.</DialogDescription>
        </DialogHeader>

        {loading ? <div className="py-4 text-center text-muted-foreground">Loading...</div> : (
          <>
            {/* Credit Score Summary */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-lg border bg-card">
              <CreditScoreBadge score={creditScore} size="md" />
              <div className="w-full sm:flex-1 min-w-0">
                <DebtProgressBar currentDebt={currentDebt} maxCreditLimit={maxCreditLimit} />
              </div>
            </div>

            <Tabs defaultValue="purchases" className="space-y-3">
              <TabsList className="w-full grid grid-cols-3 h-auto">
                <TabsTrigger value="purchases" className="text-xs sm:text-sm px-1 py-1.5">
                  Purchases ({sales.length})
                </TabsTrigger>
                <TabsTrigger value="payments" className="text-xs sm:text-sm px-1 py-1.5">
                  Payments ({payments.length})
                </TabsTrigger>
                <TabsTrigger value="credit" className="text-xs sm:text-sm px-1 py-1.5">
                  Credit
                </TabsTrigger>
              </TabsList>

              {/* Purchases - card layout on mobile */}
              <TabsContent value="purchases">
                {sales.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6 text-sm">No purchases</p>
                ) : (
                  <>
                    {/* Mobile card view */}
                    <div className="space-y-2 sm:hidden">
                      {sales.map(s => (
                        <div key={s.id} className="border rounded-lg p-3 bg-card space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
                            <Badge variant={s.payment_status === 'paid' ? 'default' : s.payment_status === 'partial' ? 'outline' : 'destructive'} className="text-xs">
                              {s.payment_status === 'paid' ? 'Paid' : s.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                            </Badge>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total</span>
                            <span className="font-medium">ETB {Number(s.total_amount).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Paid</span>
                            <span>ETB {Number(s.amount_paid || 0).toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Desktop table */}
                    <div className="hidden sm:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Paid</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sales.map(s => (
                            <TableRow key={s.id}>
                              <TableCell>{new Date(s.created_at).toLocaleDateString()}</TableCell>
                              <TableCell>ETB {Number(s.total_amount).toFixed(2)}</TableCell>
                              <TableCell>ETB {Number(s.amount_paid || 0).toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={s.payment_status === 'paid' ? 'default' : s.payment_status === 'partial' ? 'outline' : 'destructive'}>
                                  {s.payment_status === 'paid' ? 'Paid' : s.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Payments - card layout on mobile */}
              <TabsContent value="payments">
                {payments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6 text-sm">No debt payments</p>
                ) : (
                  <>
                    <div className="space-y-2 sm:hidden">
                      {payments.map(p => (
                        <div key={p.id} className="border rounded-lg p-3 bg-card space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                            <span className="text-xs text-muted-foreground">{p.payment_method}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Amount</span>
                            <span className="font-medium text-green-600">ETB {Number(p.amount).toFixed(2)}</span>
                          </div>
                          {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Method</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.map(p => (
                            <TableRow key={p.id}>
                              <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                              <TableCell className="text-green-600 font-medium">ETB {Number(p.amount).toFixed(2)}</TableCell>
                              <TableCell>{p.payment_method}</TableCell>
                              <TableCell>{p.notes || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="credit">
                <CreditHistoryTab customerId={customerId} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
