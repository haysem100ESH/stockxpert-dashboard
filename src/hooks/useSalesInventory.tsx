/**
 * useSalesInventory
 * ----------------------------------------------------------------------------
 * TanStack Query–powered cache for the Sales screen's product list and the
 * customer roster used in checkout.
 *
 * Why:
 * - The Sales screen previously refetched both lists on every mount, often
 *   running a 4-step waterfall (branch_items → medicines → branches +
 *   customers + credits + credit_logs). Switching tabs felt sluggish.
 * - Now both queries hydrate instantly from cache on revisit and revalidate
 *   in the background.
 *
 * Cache keys:
 * - ['sales-inventory', { ownerId, selectedBranch, staffBranchId }]
 * - ['sales-customers', { ownerId, selectedBranch }]
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { offlineDb, readMeta } from '@/lib/offline/db';
import { fetchCatalog, replaceCatalog } from '@/lib/offline/catalog';
import { availableStock } from '@/lib/offline/rules';
import { branchReservations } from '@/lib/offline/queue';
import { checkReachability, withPosLock } from '@/lib/offline/network';
import { useOfflineStatus } from '@/lib/offline/store';
import type { CatalogItem } from '@/lib/offline/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useOwnerBranchIds } from './useOwnerBranchIds';
import { getCreditLimit } from './useCreditScore';
import { resolveCreditLimit } from '@/lib/creditLimit';

export interface SalesMedicine {
  id: string; // branch_items.id
  medicine_id: string;
  name: string;
  generic_name?: string;
  selling_price: number;
  purchase_price: number;
  stock_quantity: number;
  category?: string;
  expiry_date?: string;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  item_type?: string;
  branch_id?: string;
  branch_name?: string;
  medicine_group?: string | null;
  strength?: string | null;
  packaging_mode?: string | null;
  main_unit_name?: string | null;
  unit_price?: number | null;
}

export interface SalesCustomer {
  id: string;
  name: string;
  phone?: string | null;
  computed_debt: number;
  credit_score: number;
  max_credit_limit: number;
}

import { chunkedInPartial } from '@/lib/supabaseBatch';

// Visible string shown when a name lookup genuinely fails after retries.
export const SALES_UNAVAILABLE = 'Unavailable';

async function fetchSalesCustomers(selectedBranch: string | null, ownerBranchIds: string[], isOwner: boolean): Promise<SalesCustomer[]> {
  if (!selectedBranch && isOwner && ownerBranchIds.length === 0) return [];

  let query = (supabase as any).from('customers').select('id, name, phone, credit_score').order('name');
  if (selectedBranch) query = query.eq('branch_id', selectedBranch);
  else if (ownerBranchIds.length > 0) query = query.in('branch_id', ownerBranchIds);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return [];

  const customerIds = data.map((c: any) => c.id) as string[];
  const [creditsRes, logsRes] = await Promise.all([
    chunkedInPartial<any>(customerIds, (ids) =>
      (supabase as any).from('customer_credits').select('customer_id, total_debt').in('customer_id', ids)
    ),
    chunkedInPartial<any>(customerIds, (ids) =>
      (supabase as any).from('credit_logs').select('customer_id, new_score, created_at').in('customer_id', ids).order('created_at', { ascending: false })
    ),
  ]);

  const debtMap: Record<string, number> = {};
  for (const credit of creditsRes.data) {
    debtMap[credit.customer_id] = Math.max(0, Number(credit.total_debt) || 0);
  }
  const latestScoreMap: Record<string, number> = {};
  for (const log of logsRes.data) {
    if (!latestScoreMap[log.customer_id]) latestScoreMap[log.customer_id] = log.new_score;
  }

  return data.map((c: any) => {
    const score = latestScoreMap[c.id] ?? c.credit_score ?? 50;
    return {
      ...c,
      computed_debt: Math.max(0, debtMap[c.id] || 0),
      credit_score: score,
      max_credit_limit: resolveCreditLimit(c.max_credit_limit ?? null, score),
      max_credit_limit_raw: c.max_credit_limit ?? null,
    };
  });
}

export const SALES_INVENTORY_KEY = (scope: { ownerId?: string; selectedBranch: string | null; staffBranchId?: string | null }) =>
  ['sales-inventory', scope] as const;
export const SALES_CUSTOMERS_KEY = (scope: { ownerId?: string; selectedBranch: string | null }) =>
  ['sales-customers', scope] as const;

export function useSalesInventory() {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();
  const { reachable } = useOfflineStatus();
  const [localRows, setLocalRows] = useState<CatalogItem[]>([]);
  const [reservations, setReservations] = useState<import('@/lib/offline/types').LocalSale[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [cachedAt, setCachedAt] = useState<string | undefined>();

  const isOwner = profile?.role === 'owner';

  // Resolve branch scope
  const branchIds = useMemo(() => {
    if (selectedBranch) return isOwner ? cachedOwnerBranchIds.filter(id => id === selectedBranch) : profile?.branch_id === selectedBranch ? [selectedBranch] : [];
    if (isOwner) return cachedOwnerBranchIds;
    if (profile?.branch_id) return [profile.branch_id];
    return [];
  }, [selectedBranch, isOwner, cachedOwnerBranchIds, profile?.branch_id]);

  const enabled = !!profile && (!isOwner || !ownerBranchesLoading);

  const inventoryKey = useMemo(
    () => SALES_INVENTORY_KEY({
      ownerId: isOwner ? profile?.id : undefined,
      selectedBranch,
      staffBranchId: !isOwner ? profile?.branch_id : undefined,
    }),
    [isOwner, profile?.id, profile?.branch_id, selectedBranch]
  );

  const customersKey = useMemo(
    () => SALES_CUSTOMERS_KEY({
      ownerId: isOwner ? profile?.id : undefined,
      selectedBranch,
    }),
    [isOwner, profile?.id, selectedBranch]
  );

  const scopeKey = branchIds.join(',');
  useEffect(() => {
    setLocalLoading(true);
    setLocalRows([]);
    setCachedAt(undefined);
    if (!profile || !branchIds.length) { setLocalLoading(false); return; }
    const sub = liveQuery(async () => ({
      rows: await offlineDb.catalog.where('ownerKey').equals(profile.id).and(row => branchIds.includes(row.branchId)).toArray(),
      sales: await branchReservations(branchIds),
      times: await Promise.all(branchIds.map(id => readMeta<string>(`catalogSync:${profile.id}:${id}`))),
    })).subscribe({ next: ({ rows, sales, times }) => {
      setLocalRows(rows); setReservations(sales); setLocalLoading(false);
      setCachedAt(times.filter((time): time is string => !!time).sort()[0]);
    }, error: () => { setLocalLoading(false); setCatalogError('Local storage is unavailable. Offline Sales cannot open on this device.'); } });
    return () => sub.unsubscribe();
  }, [profile?.id, scopeKey]);

  const refresh = useCallback(async () => {
    if (!profile || !branchIds.length || !await checkReachability()) return;
    try {
      await withPosLock(async () => {
        const rows = await fetchCatalog(branchIds, profile.id);
        await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog(branchIds, profile.id, rows));
      });
      setCatalogError('');
    } catch (error) { setCatalogError(error instanceof Error ? error.message : 'Could not refresh prices and stock. The last saved catalog is shown.'); }
  }, [profile?.id, scopeKey]);
  useEffect(() => {
    if (!enabled || !reachable) return;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => { clearInterval(interval); };
  }, [enabled, reachable, refresh]);
  const medicines = useMemo(() => localRows.map(row => ({ ...row,
    stock_quantity: availableStock(row.serverAvailable, row.id, reservations),
  })).filter(row => row.stock_quantity > 0), [localRows, reservations]);
  const packagingMap = useMemo(() => Object.fromEntries(localRows.filter(row => row.packaging)
    .map(row => [row.medicine_id, row.packaging])) as Record<string, import('@/lib/packaging').Packaging>, [localRows]);

  const customersQuery = useQuery({
    queryKey: customersKey,
    queryFn: () => fetchSalesCustomers(selectedBranch, cachedOwnerBranchIds, isOwner),
    enabled: enabled && reachable,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Pull-to-refresh + post-sale broadcast. Use refetchQueries so the active
  // list updates immediately rather than waiting for the next focus event.
  useEffect(() => {
    const handler = () => {
      if (!reachable) return;
      void refresh();
      queryClient.refetchQueries({ queryKey: ['sales-customers'] });
      queryClient.refetchQueries({ queryKey: ['branch-inventory'] });
    };
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient, refresh, reachable]);

  // Realtime: refetch when branch_items / inventory_batches change for our scope.
  useEffect(() => {
    if (!enabled || !reachable || branchIds.length === 0) return;
    const invalidate = () => {
      void refresh();
      queryClient.refetchQueries({ queryKey: ['branch-inventory'] });
    };
    const channel = (supabase as any)
      .channel(`sales-inv-${branchIds.join('-')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branch_items' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, invalidate)
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [enabled, reachable, scopeKey, queryClient, refresh]);

  return {
    medicines, packagingMap, cachedAt, catalogError,
    customers: reachable ? customersQuery.data ?? [] : [],
    loading: localLoading || (reachable && !cachedAt && ownerBranchesLoading),
    isFetching: customersQuery.isFetching,
    refetchMedicines: refresh,
    refetchCustomers: customersQuery.refetch,
    invalidate: () => {
      void refresh();
      queryClient.refetchQueries({ queryKey: ['sales-customers'] });
    },
  };
}
