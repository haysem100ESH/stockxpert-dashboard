/**
 * useDashboardStats
 * ----------------------------------------------------------------------------
 * TanStack Query–powered cache for the Owner Dashboard "Overview" data.
 *
 * Why:
 * - Previously the overview re-ran 5+ Supabase queries on every mount and on
 *   every branch / date-filter change. Returning to the dashboard always
 *   showed a spinner.
 * - Now the data is cached per (ownerId, selectedBranch, dateFilter). On
 *   revisit the cached data renders instantly while the latest data
 *   revalidates silently in the background.
 *
 * Cache key: ['dashboard-stats', { ownerId, selectedBranch, dateFilter }]
 * Stale time: 60s. Pull-to-refresh and explicit invalidations bust it.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/db";
import { useAuth } from "./useAuth";
import { useBranchContext } from "./useBranchContext";
import { useOwnerBranchIds } from "./useOwnerBranchIds";
import { addisDayString, addisPeriodStartDay } from "@/lib/timezone";

export type DateFilter = "daily" | "weekly" | "monthly" | "yearly";

export interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
  totalSoldItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
}

export interface CategorySalesData {
  category: string;
  sales: number;
  revenue: number;
}
export interface ProductPerformanceData {
  name: string;
  sales: number;
  revenue: number;
}
export interface PaymentMethodData {
  method: string;
  amount: number;
}
export interface GroupSalesData {
  name: string;
  code: string;
  sales: number;
}

export interface DashboardOverview {
  stats: DashboardStats;
  categorySales: CategorySalesData[];
  medicinesCategorySales: CategorySalesData[];
  itemsCategorySales: CategorySalesData[];
  productPerformance: ProductPerformanceData[];
  topMedicines: ProductPerformanceData[];
  topItems: ProductPerformanceData[];
  paymentMethodData: PaymentMethodData[];
  creditOverview: { avgScore: number; atRisk: number; totalExposure: number; totalCustomers: number };
  totalGroups: number;
  topGroupSales: GroupSalesData[];
}

const MEDICINE_CATEGORIES = ["tablet", "capsule", "syrup", "injection", "cream", "ointment", "drops", "inhaler"];

const EMPTY_OVERVIEW: DashboardOverview = {
  stats: {
    totalRevenue: 0,
    totalProducts: 0,
    totalMedicines: 0,
    totalItems: 0,
    totalSoldItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0,
  },
  categorySales: [],
  medicinesCategorySales: [],
  itemsCategorySales: [],
  productPerformance: [],
  topMedicines: [],
  topItems: [],
  paymentMethodData: [],
  creditOverview: { avgScore: 0, atRisk: 0, totalExposure: 0, totalCustomers: 0 },
  totalGroups: 0,
  topGroupSales: [],
};

interface FetchArgs {
  selectedBranch: string | null;
  ownerBranchIds: string[];
  dateFilter: DateFilter;
  isOwner: boolean;
}

async function fetchDashboardOverview({
  selectedBranch,
  ownerBranchIds,
  dateFilter,
  isOwner,
}: FetchArgs): Promise<DashboardOverview> {
  if (!selectedBranch && isOwner && ownerBranchIds.length === 0) {
    return EMPTY_OVERVIEW;
  }
  // Staff MUST have a branch — if not yet resolved, return empty (prevents
  // unfiltered queries that would leak cross-branch counts via RLS).
  if (!selectedBranch && !isOwner) {
    return EMPTY_OVERVIEW;
  }

  // Build all primary queries.
  // NOTE: explicit .range() is required to bypass Supabase's default 1000-row cap,
  // which silently truncates results for owners with hundreds of items / sales.
  // We also dropped the redundant `salesQuery` — `salesWithItemsQuery` returns the
  // same rows plus the joined sale_items, so one round-trip is enough.
  // Filter on `sale_date` using Ethiopia (Africa/Addis_Ababa) local dates so
  // analytics reflect the current calendar day in Addis regardless of the
  // browser's or server's timezone.
  const startDay = addisPeriodStartDay(dateFilter);
  const endDay = addisDayString();

  let salesWithItemsQuery = supabase
    .from("sales")
    .select(
      "id, total_amount, extra_profit, payment_method, discount_amount, branch_id, created_at, sale_date, sale_items(quantity, medicine_id, medicines(name, category, medicine_code_id))",
    )
    .gte("sale_date", startDay)
    .lte("sale_date", endDay)
    .range(0, 49999);
  let branchItemsQuery = supabase
    .from("branch_items")
    .select("id, quantity, expiry_date, medicines!inner(category, minimum_stock_level, medicine_code_id)")
    .range(0, 49999);
  let custQuery = supabase.from("customers").select("id, credit_score, max_credit_limit, branch_id").range(0, 9999);
  let salesDebtQuery = supabase
    .from("sales")
    .select("total_amount, amount_paid, customer_id, branch_id")
    .not("customer_id", "is", null)
    .range(0, 49999);
  // Batch-level expiry data — items have multiple batches with different expiries.
  let batchesQuery: any = supabase
    .from("inventory_batches")
    .select("branch_item_id, expiry_date, remaining_quantity, branch_id")
    .gt("remaining_quantity", 0)
    .not("expiry_date", "is", null)
    .range(0, 49999);

  if (selectedBranch) {
    branchItemsQuery = branchItemsQuery.eq("branch_id", selectedBranch);
    salesWithItemsQuery = salesWithItemsQuery.eq("branch_id", selectedBranch);
    custQuery = custQuery.eq("branch_id", selectedBranch);
    salesDebtQuery = salesDebtQuery.eq("branch_id", selectedBranch);
    batchesQuery = batchesQuery.eq("branch_id", selectedBranch);
  } else if (ownerBranchIds.length > 0) {
    branchItemsQuery = branchItemsQuery.in("branch_id", ownerBranchIds);
    salesWithItemsQuery = salesWithItemsQuery.in("branch_id", ownerBranchIds);
    custQuery = custQuery.in("branch_id", ownerBranchIds);
    salesDebtQuery = salesDebtQuery.in("branch_id", ownerBranchIds);
    batchesQuery = batchesQuery.in("branch_id", ownerBranchIds);
  }

  // Fire all queries in parallel.
  const codesQuery = (supabase as any).from("medicine_codes").select("id, code, label").range(0, 9999);
  const [branchItemsRes, salesWithItemsRes, custRes, salesDebtRes, codesRes, batchesRes] = await Promise.all([
    branchItemsQuery,
    salesWithItemsQuery,
    custQuery,
    salesDebtQuery,
    codesQuery,
    batchesQuery,
  ]);

  const branchItemsData = branchItemsRes.data || [];
  const salesWithItems = salesWithItemsRes.data || [];
  const custData = custRes.data || [];
  const salesDebt = salesDebtRes.data || [];
  const codesData: Array<{ id: string; code: string; label: string }> = codesRes.data || [];

  // Derive flat sales list + sale items from the consolidated query.
  const salesData = salesWithItems;
  const saleItemsData: any[] = [];
  salesWithItems.forEach((s: any) => (s.sale_items || []).forEach((si: any) => saleItemsData.push(si)));

  // Stats
  // Include extra_profit (tips / "keep the change" overpayments) — it's real
  // income received from the customer but not part of total_amount.
  const totalRevenue = salesData.reduce(
    (sum, s: any) => sum + Number(s.total_amount) + Number(s.extra_profit || 0),
    0,
  );
  const totalProducts = branchItemsData.length;
  const totalMedicines = branchItemsData.filter((bi: any) =>
    MEDICINE_CATEGORIES.includes(bi.medicines?.category),
  ).length;
  const totalItems = branchItemsData.filter((bi: any) => !MEDICINE_CATEGORIES.includes(bi.medicines?.category)).length;
  const lowStockItems = branchItemsData.filter(
    (bi: any) => bi.quantity <= (bi.medicines?.minimum_stock_level || 0) && bi.quantity > 0,
  ).length;
  const outOfStockItems = branchItemsData.filter((bi: any) => bi.quantity === 0).length;
  const totalSoldItems = saleItemsData.reduce((sum, item: any) => sum + item.quantity, 0);
  const today = addisDayString();
  // Expired items: distinct branch_items that have at least one batch with an
  // expired date (batches are the source of truth). Fall back to branch_items
  // legacy expiry for items without batches.
  const batchesData: any[] = batchesRes.data || [];
  const expiredFromBatches = new Set<string>();
  batchesData.forEach((b: any) => {
    if (b.expiry_date && b.expiry_date <= today) expiredFromBatches.add(b.branch_item_id);
  });
  const batchedItemIds = new Set(batchesData.map((b: any) => b.branch_item_id));
  const expiredLegacy = branchItemsData
    .filter((bi: any) => !batchedItemIds.has(bi.id) && bi.expiry_date && bi.quantity > 0 && bi.expiry_date <= today)
    .map((bi: any) => bi.id);
  expiredLegacy.forEach((id: string) => expiredFromBatches.add(id));
  const expiredItems = expiredFromBatches.size;

  // Category aggregations
  const categoryMap = new Map<string, { sales: number; revenue: number }>();
  const medicineCategoryMap = new Map<string, { sales: number; revenue: number }>();
  const itemCategoryMap = new Map<string, { sales: number; revenue: number }>();
  const productMap = new Map<string, { sales: number; revenue: number; category: string }>();

  salesWithItems.forEach((sale: any) => {
    const totalQty = sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1;
    sale.sale_items?.forEach((item: any) => {
      if (!item.medicines) return;
      const category = item.medicines.category;
      const isMedicine = MEDICINE_CATEGORIES.includes(category);
      const itemRevenue = (Number(sale.total_amount) * item.quantity) / totalQty;

      const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
      categoryMap.set(category, { sales: existing.sales + item.quantity, revenue: existing.revenue + itemRevenue });

      const targetMap = isMedicine ? medicineCategoryMap : itemCategoryMap;
      const ex = targetMap.get(category) || { sales: 0, revenue: 0 };
      targetMap.set(category, { sales: ex.sales + item.quantity, revenue: ex.revenue + itemRevenue });

      const name = item.medicines.name;
      const pe = productMap.get(name) || { sales: 0, revenue: 0, category };
      productMap.set(name, { sales: pe.sales + item.quantity, revenue: pe.revenue + itemRevenue, category });
    });
  });

  const toArr = (map: Map<string, { sales: number; revenue: number }>) =>
    Array.from(map.entries()).map(([category, d]) => ({ category, ...d }));

  const productPerformance = Array.from(productMap.entries())
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  const topMedicines = Array.from(productMap.entries())
    .filter(([, d]) => MEDICINE_CATEGORIES.includes(d.category))
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  const topItems = Array.from(productMap.entries())
    .filter(([, d]) => !MEDICINE_CATEGORIES.includes(d.category))
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  // Payment methods
  const paymentMap = new Map<string, number>();
  salesData.forEach((sale: any) => {
    const method = sale.payment_method || "Cash";
    // total_amount is already net of discount at sale time; do NOT subtract it
    // again. Include extra_profit (tips / kept change) as real cash received.
    const amount = Number(sale.total_amount) + Number(sale.extra_profit || 0);
    paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
  });
  const paymentMethodData = Array.from(paymentMap.entries()).map(([method, amount]) => ({ method, amount }));

  // Credit overview
  let creditOverview = { avgScore: 0, atRisk: 0, totalExposure: 0, totalCustomers: 0 };
  if (custData.length > 0) {
    const scores = custData.map((c: any) => c.credit_score ?? 50);
    const avgScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
    const atRisk = scores.filter((s: number) => s < 30).length;
    const custIds = new Set(custData.map((c: any) => c.id));
    const totalExposure = salesDebt
      .filter((s: any) => custIds.has(s.customer_id))
      .reduce((sum: number, s: any) => sum + Math.max(0, Number(s.total_amount) - Number(s.amount_paid || 0)), 0);
    creditOverview = { avgScore, atRisk, totalExposure, totalCustomers: custData.length };
  }

  // Group (medicine_code) aggregations — number of distinct sales transactions per group.
  const codeMap = new Map<string, { code: string; label: string }>();
  codesData.forEach((c) => codeMap.set(c.id, { code: c.code, label: c.label }));
  const groupSalesIds = new Map<string, Set<string>>();
  salesWithItems.forEach((sale: any) => {
    const codeIdsInSale = new Set<string>();
    (sale.sale_items || []).forEach((si: any) => {
      const cid = si.medicines?.medicine_code_id;
      if (cid && codeMap.has(cid)) codeIdsInSale.add(cid);
    });
    codeIdsInSale.forEach((cid) => {
      if (!groupSalesIds.has(cid)) groupSalesIds.set(cid, new Set());
      groupSalesIds.get(cid)!.add(sale.id);
    });
  });
  const topGroupSales: GroupSalesData[] = Array.from(groupSalesIds.entries())
    .map(([cid, ids]) => ({
      name: codeMap.get(cid)?.label || codeMap.get(cid)?.code || "Unknown",
      code: codeMap.get(cid)?.code || "",
      sales: ids.size,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  // Branch-scoped group count: only count medicine codes that actually have
  // items in the current branch context (not the owner-wide master catalog).
  const branchCodeIds = new Set<string>();
  branchItemsData.forEach((bi: any) => {
    const cid = bi.medicines?.medicine_code_id;
    if (cid) branchCodeIds.add(cid);
  });
  const totalGroups = branchCodeIds.size;

  return {
    stats: {
      totalRevenue,
      totalProducts,
      totalMedicines,
      totalItems,
      totalSoldItems,
      lowStockItems,
      outOfStockItems,
      expiredItems,
    },
    categorySales: toArr(categoryMap),
    medicinesCategorySales: toArr(medicineCategoryMap),
    itemsCategorySales: toArr(itemCategoryMap),
    productPerformance,
    topMedicines,
    topItems,
    paymentMethodData,
    creditOverview,
    totalGroups,
    topGroupSales,
  };
}

export const DASHBOARD_STATS_KEY = (scope: {
  ownerId?: string;
  selectedBranch: string | null;
  dateFilter: DateFilter;
}) => ["dashboard-stats", scope] as const;

export function useDashboardStats(dateFilter: DateFilter) {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();

  const isOwner = profile?.role === "owner";
  // For staff, the branch context's selectedBranch hydrates asynchronously;
  // fall back to profile.branch_id immediately so the dashboard never queries
  // without a branch filter (which would expose cross-branch totals via RLS).
  const effectiveBranch = isOwner ? selectedBranch : selectedBranch || profile?.branch_id || null;
  const enabled = !!profile && (isOwner ? !ownerBranchesLoading : !!effectiveBranch);

  const queryKey = useMemo(
    () =>
      DASHBOARD_STATS_KEY({
        ownerId: isOwner ? profile?.id : undefined,
        selectedBranch: effectiveBranch,
        dateFilter,
      }),
    [isOwner, profile?.id, effectiveBranch, dateFilter],
  );

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchDashboardOverview({
        selectedBranch: effectiveBranch,
        ownerBranchIds: cachedOwnerBranchIds,
        dateFilter,
        isOwner,
      }),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev, // instant hydration on revisit / filter change
  });

  // Pull-to-refresh interop
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, [queryClient]);

  return {
    data: query.data ?? EMPTY_OVERVIEW,
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
  };
}
