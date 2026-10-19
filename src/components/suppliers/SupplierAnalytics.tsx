import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/db';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { useToast } from '@/hooks/use-toast';
import { DollarSign, TrendingUp, Truck, ShoppingCart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

export default function SupplierAnalytics() {
  const [stats, setStats] = useState({ totalPurchases: 0, totalDebt: 0, topSupplier: '', monthlyTotal: 0 });
  const [bySupplier, setBySupplier] = useState<{ name: string; total: number }[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: ownerBranchIds } = useOwnerBranchIds();
  const { toast } = useToast();

  useEffect(() => { fetchAnalytics(); }, [selectedBranch, profile?.id, ownerBranchIds.join(',')]);

  const applyBranchFilter = (q: any) => {
    if (selectedBranch) return q.eq('branch_id', selectedBranch);
    if (profile?.role === 'owner') {
      if (ownerBranchIds.length === 0) return q.eq('branch_id', '__none__');
      return q.in('branch_id', ownerBranchIds);
    }
    if (profile?.branch_id) return q.eq('branch_id', profile.branch_id);
    return q;
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      let purchaseQuery = supabase.from('supplier_purchases').select('supplier_id, total_cost, created_at');
      purchaseQuery = applyBranchFilter(purchaseQuery);
      const { data: purchases } = await purchaseQuery;

      let debtQuery = supabase.from('supplier_debts').select('total_debt');
      debtQuery = applyBranchFilter(debtQuery);
      const { data: debts } = await debtQuery;

      // Fetch supplier names
      const supplierIds = [...new Set((purchases || []).map(p => p.supplier_id))];
      const { data: suppliers } = await supabase.from('suppliers').select('id, name').in('id', supplierIds.length > 0 ? supplierIds : ['none']);
      const nameMap: Record<string, string> = {};
      for (const s of suppliers || []) nameMap[s.id] = s.name;

      const totalPurchases = (purchases || []).reduce((s, p) => s + Number(p.total_cost), 0);
      const totalDebt = (debts || []).reduce((s, d) => s + Number(d.total_debt), 0);

      // By supplier
      const supplierTotals: Record<string, number> = {};
      for (const p of purchases || []) {
        const name = nameMap[p.supplier_id] || 'Unknown';
        supplierTotals[name] = (supplierTotals[name] || 0) + Number(p.total_cost);
      }
      const bySupplierArr = Object.entries(supplierTotals).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
      const topSupplier = bySupplierArr[0]?.name || 'N/A';

      // Monthly trend (last 6 months)
      const monthTotals: Record<string, number> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthTotals[key] = 0;
      }
      for (const p of purchases || []) {
        const d = new Date(p.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in monthTotals) monthTotals[key] += Number(p.total_cost);
      }
      const monthlyArr = Object.entries(monthTotals).map(([month, total]) => ({
        month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        total,
      }));

      // This month total
      const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthlyTotal = monthTotals[thisMonthKey] || 0;

      setStats({ totalPurchases, totalDebt, topSupplier, monthlyTotal });
      setBySupplier(bySupplierArr.slice(0, 8));
      setMonthlyTrend(monthlyArr);
    } catch {
      toast({ title: 'Error', description: 'Failed to load analytics', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading analytics...</div>;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><ShoppingCart className="h-8 w-8 text-primary" /><div><p className="text-xs text-muted-foreground">Total Purchases</p><p className="text-xl font-bold">ETB {stats.totalPurchases.toFixed(2)}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><DollarSign className="h-8 w-8 text-destructive" /><div><p className="text-xs text-muted-foreground">Supplier Debt</p><p className="text-xl font-bold text-destructive">ETB {stats.totalDebt.toFixed(2)}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Truck className="h-8 w-8 text-green-600" /><div><p className="text-xs text-muted-foreground">Top Supplier</p><p className="text-lg font-bold truncate">{stats.topSupplier}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><TrendingUp className="h-8 w-8 text-amber-500" /><div><p className="text-xs text-muted-foreground">This Month</p><p className="text-xl font-bold">ETB {stats.monthlyTotal.toFixed(2)}</p></div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Monthly Purchase Trends</CardTitle></CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} /><Tooltip formatter={(v: number) => `ETB ${v.toFixed(2)}`} /><Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">No purchase data yet</p>}
          </CardContent>
        </Card>

        {/* By Supplier */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Purchases by Supplier</CardTitle></CardHeader>
          <CardContent>
            {bySupplier.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={bySupplier} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false} fontSize={10}>
                    {bySupplier.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `ETB ${v.toFixed(2)}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">No purchase data yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
