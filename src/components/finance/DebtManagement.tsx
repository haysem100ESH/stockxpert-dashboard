import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Phone, AlertTriangle, Users, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import RecordPaymentDialog from '@/components/customers/RecordPaymentDialog';

interface CustomerDebt {
  id: string;
  name: string;
  phone: string | null;
  branch_id: string | null;
  branch_name?: string;
  total_purchases: number;
  total_paid: number;
  total_debt: number;
  last_transaction_date: string | null;
  payment_count: number;
  credit_status: 'Good' | 'Average' | 'Risky';
}

function calculateCreditStatus(debt: number, paymentCount: number, totalPurchases: number): 'Good' | 'Average' | 'Risky' {
  if (debt === 0) return 'Good';
  const debtRatio = totalPurchases > 0 ? debt / totalPurchases : 1;
  if (debtRatio > 0.6 || (debt > 0 && paymentCount === 0)) return 'Risky';
  if (debtRatio > 0.3) return 'Average';
  return 'Good';
}

const statusColors: Record<string, string> = {
  Good: 'bg-green-100 text-green-800 border-green-200',
  Average: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Risky: 'bg-red-100 text-red-800 border-red-200',
};

export default function DebtManagement() {
  const [customers, setCustomers] = useState<CustomerDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentCustomer, setPaymentCustomer] = useState<{ id: string; name: string; debt: number } | null>(null);
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: ownerBranchIds } = useOwnerBranchIds();

  useEffect(() => {
    fetchDebtData();
  }, [selectedBranch, profile?.id, ownerBranchIds.join(',')]);

  const applyBranchFilter = (q: any) => {
    if (selectedBranch) return q.eq('branch_id', selectedBranch);
    if (profile?.role === 'owner') {
      if (ownerBranchIds.length === 0) return q.eq('branch_id', '__none__');
      return q.in('branch_id', ownerBranchIds);
    }
    if (profile?.branch_id) return q.eq('branch_id', profile.branch_id);
    return q;
  };

  const fetchDebtData = async () => {
    try {
      let customersQuery = supabase.from('customers').select('id, name, phone, branch_id');
      customersQuery = applyBranchFilter(customersQuery);
      const { data: customersData, error: custErr } = await customersQuery;
      if (custErr) throw custErr;

      // Fetch branches for names
      const { data: branchesData } = await supabase.from('pharmacy_branches').select('id, name');
      const branchMap = new Map((branchesData || []).map(b => [b.id, b.name]));

      // Fetch debt from customer_credits table
      const customerIds = (customersData || []).map((c: any) => c.id);
      const { data: creditsData } = await (supabase as any)
        .from('customer_credits')
        .select('customer_id, total_debt')
        .in('customer_id', customerIds);

      const debtMap: Record<string, number> = {};
      for (const credit of creditsData || []) {
        debtMap[credit.customer_id] = Math.max(0, Number(credit.total_debt) || 0);
      }

      // Fetch sales for total purchases & last date
      let salesQuery = supabase
        .from('sales')
        .select('customer_id, total_amount, created_at')
        .not('customer_id', 'is', null);
      salesQuery = applyBranchFilter(salesQuery);
      const { data: salesData } = await salesQuery;

      // Fetch payment count
      let paymentsQuery = supabase.from('customer_payments').select('customer_id');
      paymentsQuery = applyBranchFilter(paymentsQuery);
      const { data: paymentsData } = await paymentsQuery;

      const customerDebts: CustomerDebt[] = (customersData || []).map(customer => {
        const custSales = (salesData || []).filter((s: any) => s.customer_id === customer.id);
        const custPayments = (paymentsData || []).filter((p: any) => p.customer_id === customer.id);
        
        const totalPurchases = custSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0);
        const totalDebt = debtMap[customer.id] || 0;
        const totalPaid = Math.max(0, totalPurchases - totalDebt);

        const lastSale = custSales.sort((a: any, b: any) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())[0];

        return {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          branch_id: customer.branch_id,
          branch_name: customer.branch_id ? branchMap.get(customer.branch_id) : undefined,
          total_purchases: totalPurchases,
          total_paid: totalPaid,
          total_debt: totalDebt,
          last_transaction_date: lastSale?.created_at || null,
          payment_count: custPayments.length,
          credit_status: calculateCreditStatus(totalDebt, custPayments.length, totalPurchases),
        };
      }).filter(c => c.total_debt > 0).sort((a, b) => b.total_debt - a.total_debt);

      setCustomers(customerDebts);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch debt data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const totalDebt = customers.reduce((sum, c) => sum + c.total_debt, 0);
  const riskyCount = customers.filter(c => c.credit_status === 'Risky').length;

  if (loading) return <div>Loading debt data...</div>;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
            <DollarSign className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {totalDebt.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Customers with Debt</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risky Customers</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{riskyCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Customer Debt List */}
      <Card>
        <CardHeader>
          <CardTitle>Customer Debts</CardTitle>
          <CardDescription>Customers with outstanding balances, sorted by amount</CardDescription>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No outstanding debts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {customers.map(customer => (
                <div key={customer.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{customer.name}</span>
                      <Badge className={`text-xs ${statusColors[customer.credit_status]}`}>
                        {customer.credit_status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {customer.branch_name && <span>Branch: {customer.branch_name}</span>}
                      {customer.last_transaction_date && (
                        <span>Last: {new Date(customer.last_transaction_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold text-destructive whitespace-nowrap">
                      ETB {customer.total_debt.toFixed(2)}
                    </span>
                    {customer.phone && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={`tel:${customer.phone}`}>
                          <Phone className="h-3.5 w-3.5 mr-1" />
                          Call
                        </a>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => setPaymentCustomer({
                        id: customer.id,
                        name: customer.name,
                        debt: customer.total_debt,
                      })}
                    >
                      Record Payment
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {paymentCustomer && (
        <RecordPaymentDialog
          open={!!paymentCustomer}
          onOpenChange={(open) => !open && setPaymentCustomer(null)}
          customerId={paymentCustomer.id}
          customerName={paymentCustomer.name}
          outstandingAmount={paymentCustomer.debt}
          onPaymentRecorded={() => {
            setPaymentCustomer(null);
            fetchDebtData();
          }}
        />
      )}
    </div>
  );
}
