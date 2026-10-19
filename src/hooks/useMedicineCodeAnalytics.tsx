/**
 * useMedicineCodeAnalytics
 * --------------------------------------------------------------------------
 * Aggregations powering the Medicine Codes drill-down dashboard:
 *   - batches per medicine (stock + expiry status)
 *   - sales aggregates per medicine_code (qty + revenue) over a time range
 *
 * Scoped to the current branch context (owner-all-branches, owner-selected,
 * or staff branch).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useOwnerBranchIds } from './useOwnerBranchIds';
import { useExpiryThreshold } from './useExpiryThreshold';

export interface BatchRow {
  id: string;
  branch_item_id: string | null;
  medicine_id: string;
  batch_number: string | null;
  remaining_quantity: number;
  expiry_date: string | null;
  expiry_alert_days: number | null;
  purchase_price: number | null;
  selling_price: number | null;
  branch_id: string;
}

export type ExpiryStatus = 'expired' | 'expiring' | 'normal' | 'unknown';

export function classifyExpiry(
  expiry: string | null,
  alertDays: number,
): ExpiryStatus {
  if (!expiry) return 'unknown';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry); exp.setHours(0, 0, 0, 0);
  if (exp < today) return 'expired';
  const days = Math.ceil((exp.getTime() - today.getTime()) / 86_400_000);
  return days <= alertDays ? 'expiring' : 'normal';
}

function useScopedBranchIds(): { branchIds: string[]; ready: boolean } {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: ownerBranchIds, isLoading } = useOwnerBranchIds();
  if (!profile) return { branchIds: [], ready: false };
  if (selectedBranch) return { branchIds: [selectedBranch], ready: true };
  if (profile.role === 'owner') return { branchIds: ownerBranchIds, ready: !isLoading };
  if (profile.branch_id) return { branchIds: [profile.branch_id], ready: true };
  return { branchIds: [], ready: true };
}

async function fetchBatches(branchIds: string[]): Promise<BatchRow[]> {
  if (branchIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('inventory_batches')
    .select('id, branch_item_id, medicine_id, batch_number, remaining_quantity, expiry_date, expiry_alert_days, purchase_price, selling_price, branch_id')
    .in('branch_id', branchIds)
    .range(0, 49999);
  if (error) throw error;
  return (data || []) as BatchRow[];
}

export type SalesRange = 'daily' | 'weekly' | 'monthly';

function rangeStart(range: SalesRange): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (range === 'daily') return d;
  if (range === 'weekly') {
    d.setDate(d.getDate() - 6);
    return d;
  }
  d.setDate(d.getDate() - 29);
  return d;
}

export interface SaleItemRow {
  medicine_id: string;
  quantity: number;
  total_price: number;
  created_at: string;
}

async function fetchSaleItems(branchIds: string[], since: Date): Promise<SaleItemRow[]> {
  if (branchIds.length === 0) return [];
  const sinceDay = since.toISOString().slice(0, 10);
  const { data, error } = await (supabase as any)
    .from('sale_items')
    .select('medicine_id, quantity, total_price, created_at, sales!inner(branch_id, sale_date, created_at)')
    .in('sales.branch_id', branchIds)
    .gte('sales.sale_date', sinceDay)
    .range(0, 49999);
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    medicine_id: r.medicine_id,
    quantity: Number(r.quantity) || 0,
    total_price: Number(r.total_price) || 0,
    // Prefer business sale_date; fall back to sale's created_at then row's.
    created_at: r.sales?.sale_date || r.sales?.created_at || r.created_at,
  }));
}

export function useMedicineCodeBatches() {
  const { branchIds, ready } = useScopedBranchIds();
  const { days: globalAlertDays } = useExpiryThreshold();

  const query = useQuery({
    queryKey: ['mcode-batches', branchIds.join(',')],
    queryFn: () => fetchBatches(branchIds),
    enabled: ready && branchIds.length > 0,
    staleTime: 60_000,
  });

  const byMedicine = useMemo(() => {
    const m = new Map<string, BatchRow[]>();
    for (const b of query.data || []) {
      if (!m.has(b.medicine_id)) m.set(b.medicine_id, []);
      m.get(b.medicine_id)!.push(b);
    }
    return m;
  }, [query.data]);

  return {
    batches: query.data || [],
    batchesByMedicine: byMedicine,
    globalAlertDays,
    loading: query.isLoading,
  };
}

export interface CodeSalesAgg {
  codeId: string;
  totalQty: number;
  totalRevenue: number;
}

export function useMedicineCodeSales(
  range: SalesRange,
  medicineIdToCodeId: Map<string, string | null>,
) {
  const { branchIds, ready } = useScopedBranchIds();
  const since = useMemo(() => rangeStart(range), [range]);

  const query = useQuery({
    queryKey: ['mcode-sales', branchIds.join(','), range],
    queryFn: () => fetchSaleItems(branchIds, since),
    enabled: ready && branchIds.length > 0,
    staleTime: 60_000,
  });

  const { perCode, trend } = useMemo(() => {
    const agg = new Map<string, CodeSalesAgg>();
    const trendBuckets = new Map<string, { qty: number; revenue: number }>();

    for (const si of query.data || []) {
      const codeId = medicineIdToCodeId.get(si.medicine_id) || null;
      if (codeId) {
        const cur = agg.get(codeId) || { codeId, totalQty: 0, totalRevenue: 0 };
        cur.totalQty += si.quantity;
        cur.totalRevenue += si.total_price;
        agg.set(codeId, cur);
      }
      // trend bucket key
      const d = new Date(si.created_at);
      let key: string;
      if (range === 'daily') {
        key = `${d.getHours().toString().padStart(2, '0')}:00`;
      } else if (range === 'weekly') {
        key = d.toISOString().slice(0, 10);
      } else {
        key = d.toISOString().slice(0, 10);
      }
      const t = trendBuckets.get(key) || { qty: 0, revenue: 0 };
      t.qty += si.quantity;
      t.revenue += si.total_price;
      trendBuckets.set(key, t);
    }

    const trendArr = Array.from(trendBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, v]) => ({ label, qty: v.qty, revenue: v.revenue }));

    return {
      perCode: Array.from(agg.values()).sort((a, b) => b.totalRevenue - a.totalRevenue),
      trend: trendArr,
    };
  }, [query.data, medicineIdToCodeId, range]);

  return {
    perCode,
    trend,
    loading: query.isLoading,
  };
}
