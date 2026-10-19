import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, TrendingUp, Banknote, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface StaffSalaryInfo {
  id: string;
  full_name: string;
  salary_type: 'percentage' | 'fixed';
  salary_percentage: number;
  salary_fixed_amount: number;
  branch_id: string | null;
  branch_name?: string;
  individualSales: number;
  totalPaid: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SalaryOverview() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [staffList, setStaffList] = useState<StaffSalaryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [confirmStaff, setConfirmStaff] = useState<StaffSalaryInfo | null>(null);
  const [totalSales, setTotalSales] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [profit, setProfit] = useState(0);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchAll();

    const salesSubscription = supabase
      .channel('salary-sales-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        () => fetchAll()
      )
      .subscribe();

    return () => { supabase.removeChannel(salesSubscription); };
  }, [selectedBranch, profile, selectedMonth, selectedYear]);

  const fetchAll = async () => {
    if (!profile) return;
    setLoading(true);

    const { data: branches } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id);

    const branchIds = (branches || []).map((b: any) => b.id);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));
    const filteredBranchIds = selectedBranch ? [selectedBranch] : branchIds;

    if (filteredBranchIds.length === 0) {
      setStaffList([]);
      setTotalSales(0);
      setTotalExpenses(0);
      setProfit(0);
      setLoading(false);
      return;
    }

    const startOfMonth = new Date(selectedYear, selectedMonth - 1, 1).toISOString();
    const endOfMonth = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString();

    // Fetch profit data
    const [salesRes, expensesRes] = await Promise.all([
      supabase.from('sales').select('total_amount').in('branch_id', filteredBranchIds)
        .gte('created_at', startOfMonth).lte('created_at', endOfMonth),
      supabase.from('expenses').select('amount').in('branch_id', filteredBranchIds)
        .gte('created_at', startOfMonth).lte('created_at', endOfMonth),
    ]);

    const ts = (salesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0);
    const te = (expensesRes.data || []).reduce((s, r) => s + Number(r.amount), 0);
    setTotalSales(ts);
    setTotalExpenses(te);
    setProfit(ts - te);

    // Fetch staff
    const { data: staffData } = await supabase
      .from('profiles')
      .select('id, full_name, salary_percentage, salary_type, salary_fixed_amount, branch_id')
      .eq('role', 'staff')
      .in('branch_id', filteredBranchIds);

    const staffIds = (staffData || []).map((s: any) => s.id);

    if (staffIds.length === 0) {
      setStaffList([]);
      setLoading(false);
      return;
    }

    // Fetch all sales for month per staff & paid amounts in parallel
    const [allSalesRes, paidRes] = await Promise.all([
      supabase.from('sales')
        .select('sold_by, total_amount')
        .in('sold_by', staffIds)
        .in('branch_id', filteredBranchIds)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth),
      supabase.from('salary_expenses')
        .select('staff_id, amount')
        .in('staff_id', staffIds)
        .eq('month', selectedMonth)
        .eq('year', selectedYear),
    ]);

    // Sum sales per staff
    const salesMap: Record<string, number> = {};
    (allSalesRes.data || []).forEach((sale: any) => {
      salesMap[sale.sold_by] = (salesMap[sale.sold_by] || 0) + Number(sale.total_amount);
    });

    // Sum total paid per staff (supports multiple payments)
    const paidTotalMap: Record<string, number> = {};
    (paidRes.data || []).forEach((r: any) => {
      paidTotalMap[r.staff_id] = (paidTotalMap[r.staff_id] || 0) + Number(r.amount);
    });

    setStaffList((staffData || []).map((s: any) => ({
      ...s,
      salary_type: s.salary_type || 'percentage',
      salary_percentage: Number(s.salary_percentage) || 0,
      salary_fixed_amount: Number(s.salary_fixed_amount) || 0,
      branch_name: s.branch_id ? branchMap.get(s.branch_id) : undefined,
      individualSales: salesMap[s.id] || 0,
      totalPaid: paidTotalMap[s.id] || 0,
    })));
    setLoading(false);
  };

  const calculateTotalSalary = (staff: StaffSalaryInfo) => {
    if (staff.salary_type === 'fixed') return staff.salary_fixed_amount;
    return (staff.individualSales * staff.salary_percentage) / 100;
  };

  const calculateUnpaid = (staff: StaffSalaryInfo) => {
    const total = calculateTotalSalary(staff);
    return Math.max(0, total - staff.totalPaid);
  };

  const handlePaySalary = async (staff: StaffSalaryInfo) => {
    if (!profile) return;
    setPaying(staff.id);
    const unpaidAmount = calculateUnpaid(staff);

    try {
      const { error: salaryError } = await supabase
        .from('salary_expenses')
        .insert({
          staff_id: staff.id,
          branch_id: staff.branch_id || selectedBranch,
          amount: unpaidAmount,
          salary_percentage: staff.salary_percentage,
          branch_profit_at_payment: profit,
          payment_date: new Date().toISOString(),
          created_by: profile.id,
          month: selectedMonth,
          year: selectedYear,
          notes: `Salary for ${staff.full_name} - ${selectedMonth}/${selectedYear} (${staff.salary_type === 'fixed' ? `Fixed: ETB ${staff.salary_fixed_amount}` : `Sales: ETB ${staff.individualSales.toFixed(2)}`}, Paid: ETB ${unpaidAmount.toFixed(2)})`,
        });

      if (salaryError) throw salaryError;

      const { error: expenseError } = await supabase
        .from('expenses')
        .insert({
          description: `Salary Payment - ${staff.full_name} (${staff.salary_type === 'fixed' ? `Fixed ETB ${staff.salary_fixed_amount}` : `${staff.salary_percentage}% of sales`}, ETB ${unpaidAmount.toFixed(2)})`,
          amount: unpaidAmount,
          category: 'Salary Expense',
          branch_id: staff.branch_id || selectedBranch,
          created_by: profile.id,
        });

      if (expenseError) throw expenseError;

      toast({ title: "Success", description: `Salary of ETB ${unpaidAmount.toFixed(2)} paid to ${staff.full_name}` });
      fetchAll();
    } catch (error: any) {
      console.error('Pay salary error:', error);
      toast({ title: "Error", description: error?.message || "Failed to pay salary", variant: "destructive" });
    } finally {
      setPaying(null);
      setConfirmStaff(null);
    }
  };

  const yearOptions = [];
  for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) {
    yearOptions.push(y);
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading salary data...</div>;

  return (
    <div className="space-y-4">
      {/* Month/Year Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchAll}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Profit Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Sales</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">ETB {totalSales.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {totalExpenses.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Profit</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
              ETB {profit.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {MONTHS[selectedMonth - 1]} {selectedYear}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Staff Salary Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Staff Salary Overview
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Calculated Salary = total month sales × %. Unpaid Remaining = Calculated Salary − already paid amount.
          </p>
        </CardHeader>
        <CardContent>
          {staffList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No staff members found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Sales This Month</TableHead>
                  <TableHead className="text-right">Salary Type</TableHead>
                  <TableHead className="text-right">Calculated Salary</TableHead>
                  <TableHead className="text-right">Paid Amount</TableHead>
                  <TableHead className="text-right">Unpaid Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffList.map(staff => {
                  const totalSalary = calculateTotalSalary(staff);
                  const unpaid = calculateUnpaid(staff);
                  const fullyPaid = staff.totalPaid > 0 && unpaid <= 0;
                  return (
                    <TableRow key={staff.id}>
                      <TableCell className="font-medium">{staff.full_name}</TableCell>
                      <TableCell>{staff.branch_name || '—'}</TableCell>
                      <TableCell className="text-right">ETB {staff.individualSales.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {staff.salary_type === 'fixed'
                          ? `ETB ${staff.salary_fixed_amount.toFixed(2)}`
                          : `${staff.salary_percentage}%`}
                      </TableCell>
                      <TableCell className="text-right font-medium">ETB {totalSalary.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-success">ETB {staff.totalPaid.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-semibold ${unpaid > 0 ? 'text-destructive' : 'text-success'}`}>
                        ETB {unpaid.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={fullyPaid ? 'default' : staff.totalPaid > 0 ? 'outline' : 'secondary'}>
                          {fullyPaid ? 'Fully Paid' : staff.totalPaid > 0 ? 'Partial' : 'Unpaid'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={unpaid <= 0 || paying === staff.id}
                          onClick={() => setConfirmStaff(staff)}
                        >
                          {paying === staff.id ? 'Paying...' : unpaid > 0 && staff.totalPaid > 0 ? 'Pay Remaining' : 'Pay Salary'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={!!confirmStaff}
        onOpenChange={(open) => { if (!open) setConfirmStaff(null); }}
        title="Confirm Salary Payment"
        description={confirmStaff ? `Pay ETB ${calculateUnpaid(confirmStaff).toFixed(2)} to ${confirmStaff.full_name}? This is the unpaid remaining amount. It will be recorded as a Salary Expense.` : ''}
        onConfirm={() => confirmStaff && handlePaySalary(confirmStaff)}
        confirmText="Pay Salary"
        cancelText="Cancel"
      />
    </div>
  );
}
