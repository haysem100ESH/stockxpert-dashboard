import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { History } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface SalaryRecord {
  id: string;
  staff_name: string;
  branch_name: string;
  amount: number;
  salary_percentage: number;
  branch_profit_at_payment: number;
  payment_date: string;
  month: number;
  year: number;
  notes: string | null;
}

const MONTHS = [
  { value: '0', label: 'All Months' },
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

export default function SalaryHistory() {
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState('0');
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [staffFilter, setStaffFilter] = useState('all');
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchHistory();
  }, [selectedBranch, filterMonth, filterYear, staffFilter, profile]);

  const fetchHistory = async () => {
    if (!profile) return;
    setLoading(true);

    // Get owner's branch IDs
    const { data: branches } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id);

    const branchIds = (branches || []).map((b: any) => b.id);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));

    let query = supabase
      .from('salary_expenses')
      .select('*')
      .in('branch_id', branchIds)
      .eq('year', parseInt(filterYear))
      .order('payment_date', { ascending: false });

    if (selectedBranch) {
      query = query.eq('branch_id', selectedBranch);
    }

    if (filterMonth !== '0') {
      query = query.eq('month', parseInt(filterMonth));
    }

    if (staffFilter !== 'all') {
      query = query.eq('staff_id', staffFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching salary history:', error);
      setLoading(false);
      return;
    }

    // Fetch staff names
    const staffIds = [...new Set((data || []).map((r: any) => r.staff_id))];
    let staffMap = new Map<string, string>();
    if (staffIds.length > 0) {
      const { data: staffData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', staffIds);
      (staffData || []).forEach((s: any) => staffMap.set(s.id, s.full_name));
      setStaffOptions((staffData || []).map((s: any) => ({ id: s.id, name: s.full_name })));
    }

    setRecords((data || []).map((r: any) => ({
      ...r,
      staff_name: staffMap.get(r.staff_id) || 'Unknown',
      branch_name: branchMap.get(r.branch_id) || 'Unknown',
    })));
    setLoading(false);
  };

  const totalPaid = records.reduce((sum, r) => sum + Number(r.amount), 0);

  const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Salary Payment History
        </CardTitle>
        <div className="flex flex-wrap gap-2 pt-2">
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All Staff" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staffOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No salary payments found for the selected period.</p>
        ) : (
          <>
            <div className="mb-3 text-sm font-medium">
              Total Paid: <span className="text-primary">ETB {totalPaid.toFixed(2)}</span> ({records.length} payments)
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Branch Profit</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.staff_name}</TableCell>
                    <TableCell>{r.branch_name}</TableCell>
                    <TableCell className="text-right">ETB {Number(r.amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.salary_percentage}%</TableCell>
                    <TableCell className="text-right">ETB {Number(r.branch_profit_at_payment).toFixed(2)}</TableCell>
                    <TableCell>{new Date(r.payment_date).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
