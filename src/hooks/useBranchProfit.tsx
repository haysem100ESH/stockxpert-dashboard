import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface BranchProfit {
  totalSales: number;
  totalExpenses: number;
  profit: number;
  month: number;
  year: number;
  loading: boolean;
}

export function useBranchProfit() {
  const [data, setData] = useState<BranchProfit>({
    totalSales: 0, totalExpenses: 0, profit: 0,
    month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    loading: true,
  });
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchProfit();
  }, [selectedBranch, profile]);

  const fetchProfit = async () => {
    if (!profile) return;
    setData(d => ({ ...d, loading: true }));

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    let branchIds: string[] = [];
    if (selectedBranch) {
      branchIds = [selectedBranch];
    } else if (profile.role === 'owner') {
      const { data: branches } = await supabase
        .from('pharmacy_branches')
        .select('id')
        .eq('pharmacy_owner_id', profile.id);
      branchIds = (branches || []).map((b: any) => b.id);
    } else if (profile.branch_id) {
      branchIds = [profile.branch_id];
    }

    if (branchIds.length === 0) {
      setData({ totalSales: 0, totalExpenses: 0, profit: 0, month: now.getMonth() + 1, year: now.getFullYear(), loading: false });
      return;
    }

    // Fetch sales
    // Sales are filtered by business sale_date so monthly profit reflects the
    // accounting date the cashier picked, not the row's insertion timestamp.
    const startDay = String(startOfMonth).slice(0, 10);
    const endDay = String(endOfMonth).slice(0, 10);
    const { data: salesData } = await supabase
      .from('sales')
      .select('total_amount')
      .in('branch_id', branchIds)
      .gte('sale_date', startDay)
      .lte('sale_date', endDay);

    const totalSales = (salesData || []).reduce((sum, s) => sum + Number(s.total_amount), 0);

    // Fetch expenses
    const { data: expensesData } = await supabase
      .from('expenses')
      .select('amount')
      .in('branch_id', branchIds)
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth);

    const totalExpenses = (expensesData || []).reduce((sum, e) => sum + Number(e.amount), 0);

    setData({
      totalSales,
      totalExpenses,
      profit: totalSales - totalExpenses,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      loading: false,
    });
  };

  return { ...data, refetch: fetchProfit };
}
