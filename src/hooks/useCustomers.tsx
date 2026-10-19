/**
 * useCustomers
 * ----------------------------------------------------------------------------
 * TanStack Query–powered fetch + cache for the customers list with debt and
 * credit-score enrichment. Hydrates instantly from cache on revisit and
 * revalidates in the background.
 *
 * Cache key: ['customers', selectedBranch ?? 'all']
 * Stale time: 60s. Invalidated by pull-to-refresh and by mutation callbacks
 * (e.g. after recording a payment / creating a customer).
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useBranchContext } from './useBranchContext';
import { getCreditLimit } from './useCreditScore';
import { resolveCreditLimit } from '@/lib/creditLimit';
import { useAuth } from './useAuth';
import { useOwnerBranchIds } from './useOwnerBranchIds';

export interface CustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
  totalPurchases: number;
  totalPaid: number;
  totalDebt: number;
  lastPurchaseDate?: string;
  credit_score: number;
  /** Raw stored value (null=auto, -1=unlimited, >0=custom) */
  max_credit_limit_raw: number | null;
  /** Resolved effective limit; Infinity for unlimited */
  max_credit_limit: number;
}

async function fetchCustomers(
  selectedBranch: string | null,
  ownerBranchIds: string[],
  isOwner: boolean,
  staffBranchId: string | null,
): Promise<CustomerRow[]> {
  let query = (supabase as any).from('customers').select('*').order('name');
  if (selectedBranch) {
    query = query.eq('branch_id', selectedBranch);
  } else if (isOwner) {
    if (ownerBranchIds.length === 0) return [];
    query = query.in('branch_id', ownerBranchIds);
  } else if (staffBranchId) {
    query = query.eq('branch_id', staffBranchId);
  }
  const { data: customersData, error } = await query;
  if (error) throw error;

  const customerIds: string[] = (customersData || [])
    .map((c: any) => c.id)
    .filter((id: any) => typeof id === 'string');

  if (customerIds.length === 0) return [];

  // Parallel: credits, sales, credit_logs
  const [creditsRes, salesRes, logsRes] = await Promise.all([
    (supabase as any)
      .from('customer_credits')
      .select('customer_id, total_debt')
      .in('customer_id', customerIds),
    (supabase as any)
      .from('sales')
      .select('customer_id, total_amount, created_at')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false }),
    (supabase as any)
      .from('credit_logs')
      .select('customer_id, new_score, created_at')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false }),
  ]);

  const debtMap: Record<string, number> = {};
  for (const credit of creditsRes.data || []) {
    if (credit.customer_id) {
      debtMap[credit.customer_id] = Math.max(0, Number(credit.total_debt) || 0);
    }
  }

  const allSales = (salesRes.data || []).filter((s: any) => s.customer_id !== null);

  const latestScoreMap: Record<string, number> = {};
  for (const log of logsRes.data || []) {
    if (!latestScoreMap[log.customer_id]) {
      latestScoreMap[log.customer_id] = log.new_score;
    }
  }

  return (customersData || []).map((c: any) => {
    const custSales = allSales.filter((s: any) => s.customer_id === c.id);
    const totalPurchases = custSales.reduce((s: number, r: any) => s + Number(r.total_amount), 0);
    const lastPurchaseDate = custSales[0]?.created_at;
    const totalDebt = debtMap[c.id] || 0;
    const totalPaid = Math.max(0, totalPurchases - totalDebt);
    const creditScore = latestScoreMap[c.id] ?? c.credit_score ?? 50;
    const rawLimit: number | null = c.max_credit_limit ?? null;
    const maxCreditLimit = resolveCreditLimit(rawLimit, creditScore);
    return {
      ...c,
      totalPurchases,
      totalPaid,
      totalDebt,
      lastPurchaseDate,
      credit_score: creditScore,
      max_credit_limit_raw: rawLimit,
      max_credit_limit: maxCreditLimit,
    } as CustomerRow;
  });
}

export const CUSTOMERS_KEY = (selectedBranch: string | null) =>
  ['customers', selectedBranch ?? 'all'] as const;

export function useCustomers() {
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();
  const { branchIds: ownerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();
  const isOwner = profile?.role === 'owner';
  const staffBranchId = profile?.branch_id ?? null;
  const queryKey = [
    'customers',
    selectedBranch ?? (isOwner ? `owner:${(ownerBranchIds || []).join(',')}` : `staff:${staffBranchId ?? ''}`),
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchCustomers(selectedBranch, ownerBranchIds, isOwner, staffBranchId),
    enabled: !!profile && (isOwner ? !ownerBranchesLoading : true),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['customers'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  return {
    customers: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  };
}
