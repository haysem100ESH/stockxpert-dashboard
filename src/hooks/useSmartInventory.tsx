/**
 * useSmartInventory
 * ----------------------------------------------------------------------------
 * v3 — Weighted Moving Average + trend multiplier + per-item lead time ROP +
 *      expiry-adjusted effective stock.
 *
 * Demand model:
 *   wk1 = qty_7;  wk2 = qty_14 - qty_7;  wk3 = qty_21 - qty_14
 *   WMA = (wk1*3 + wk2*2 + wk3*1) / 6   (per week)
 *   ADC = WMA / 7                       (per day)
 *   Slow-mover fallback: if qty_30 = 0 but qty_60 > 0 → ADC = qty_60 / 60
 *
 * Trend:
 *   recentRate = qty_14 / 14
 *   olderRate  = (qty_30 - qty_14) / 16
 *   trend      = recentRate / olderRate, clamped [0.7, 1.5]
 *   edge: olderRate=0 & recentRate>0 → 1.3, both 0 → 1.0
 *
 * Forecast & Reorder Point:
 *   forecastDays    = max(14, leadTimeDays * 2)
 *   forecastDemand  = ADC * forecastDays * seasonalMult * trendMult
 *   safetyStock     = forecastDemand * 0.20
 *   ROP             = ADC * leadTimeDays + safetyStock
 *   effectiveStock  = stock - expiringSoonQty (batches expiring within lead time)
 *   needsReorder    = effectiveStock <= ROP  OR  effectiveStock < minStockLevel
 *   suggestedReorder= ceil( max(forecastDemand+safetyStock, minStockLevel) - effectiveStock )
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { getSeasonalMultiplier } from '@/hooks/useSeasonalPerformance';
import { getGlobalLowStockThreshold, useLowStockThreshold } from '@/hooks/useLowStockThreshold';

export interface SmartItem {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  effectiveStock: number;
  expiringSoonQty: number;
  hasExpiryExclusion: boolean;
  minStockLevel: number;
  minStockSource: 'item' | 'global';
  leadTimeDays: number;
  reorderPoint: number;
  forecastDays: number;
  expiryDate: string | null;
  sellingPrice: number;
  branchId: string;
  adc: number;
  isSlowMover: boolean;
  trendMultiplier: number;
  trendPercent: number; // (trend-1)*100, rounded
  trendDirection: 'up' | 'down' | 'stable';
  predictedDemand14: number;  // legacy alias = forecastDemand
  forecastDemand: number;
  safetyStock: number;
  suggestedReorder: number;
  needsReorder: boolean;
  daysRemaining: number | null;
  stockOutRisk: boolean;
  daysUntilExpiry: number | null;
  expiryAlertLevel: 'none' | 'warning' | 'risk' | 'critical' | 'expired';
  isDeadStock: boolean;
  lastSaleDate: string | null;
  totalSold30Days: number;
  inventoryScore: number;
  scoreLevel: 'excellent' | 'good' | 'risk' | 'critical';
}

interface RpcRow {
  branch_item_id: string;
  medicine_id: string;
  name: string;
  category: string;
  branch_id: string;
  stock_quantity: number;
  minimum_stock_level: number;
  lead_time_days: number | null;
  expiry_date: string | null;
  selling_price: number;
  item_type: string | null;
  qty_7?: number;
  qty_14?: number;
  qty_21?: number;
  qty_30: number;
  qty_60: number;
  last_sale_date: string | null;
  monthly_qty: number[];
  expiring_soon_qty?: number;
}

function calcExpiryLevel(d: number | null): SmartItem['expiryAlertLevel'] {
  if (d === null) return 'none';
  if (d <= 0) return 'expired';
  if (d < 30) return 'critical';
  if (d < 60) return 'risk';
  if (d < 90) return 'warning';
  return 'none';
}

function calcInventoryScore(it: { adc: number; currentStock: number; predictedDemand14: number; daysUntilExpiry: number | null; isDeadStock: boolean }): number {
  let s = 50;
  if (it.adc > 0) s += Math.min(20, it.adc * 5);
  if (it.predictedDemand14 > 0) {
    const r = it.currentStock / it.predictedDemand14;
    if (r >= 0.8 && r <= 2) s += 30;
    else if (r >= 0.5 && r <= 3) s += 20;
    else if (r > 0) s += 10;
  } else if (it.currentStock > 0) s += 15;
  if (it.daysUntilExpiry !== null) {
    if (it.daysUntilExpiry <= 0) s -= 30;
    else if (it.daysUntilExpiry < 30) s -= 25;
    else if (it.daysUntilExpiry < 60) s -= 15;
    else if (it.daysUntilExpiry < 90) s -= 5;
  }
  if (it.isDeadStock) s -= 20;
  return Math.max(0, Math.min(100, s));
}

function getScoreLevel(score: number): SmartItem['scoreLevel'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'risk';
  return 'critical';
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function toSmartItem(r: RpcRow, now: number, hasSalesAggregation = true): SmartItem {
  const q7 = Number(r.qty_7 ?? 0);
  const q14 = Number(r.qty_14 ?? 0);
  const q21 = Number(r.qty_21 ?? 0);
  const q30 = Number(r.qty_30 ?? 0);
  const q60 = Number(r.qty_60 ?? 0);

  // ----- ADC via Weighted Moving Average -----
  const wk1 = Math.max(0, q7);
  const wk2 = Math.max(0, q14 - q7);
  const wk3 = Math.max(0, q21 - q14);
  let adc = 0;
  let isSlowMover = false;
  // Prefer WMA when we have any weekly data; otherwise fall back
  if (wk1 + wk2 + wk3 > 0) {
    const wma = (wk1 * 3 + wk2 * 2 + wk3 * 1) / 6;
    adc = wma / 7;
  } else if (q30 > 0) {
    adc = q30 / 30;
  } else if (q60 > 0) {
    // Slow mover fallback
    adc = q60 / 60;
    isSlowMover = true;
  }

  // ----- Trend multiplier -----
  const recentRate = q14 / 14;
  const olderRate = Math.max(0, q30 - q14) / 16;
  let trendMultiplier = 1.0;
  if (olderRate === 0 && recentRate > 0) trendMultiplier = 1.3;
  else if (olderRate === 0 && recentRate === 0) trendMultiplier = 1.0;
  else trendMultiplier = clamp(recentRate / olderRate, 0.7, 1.5);
  if (isSlowMover) trendMultiplier = Math.min(trendMultiplier, 1.0);

  const trendPercent = Math.round((trendMultiplier - 1) * 100);
  const trendDirection: SmartItem['trendDirection'] =
    trendMultiplier > 1.1 ? 'up' : trendMultiplier < 0.9 ? 'down' : 'stable';

  // ----- Seasonal -----
  const seasonalMult = getSeasonalMultiplier(r.monthly_qty || new Array(12).fill(0));

  // ----- Lead time & forecast window -----
  const leadTimeDays = Math.max(1, Number(r.lead_time_days ?? 3));
  const forecastDays = Math.max(14, leadTimeDays * 2);

  const forecastDemand = adc * forecastDays * seasonalMult * trendMultiplier;
  const safetyStock = forecastDemand * 0.2;
  const reorderPoint = adc * leadTimeDays + safetyStock;

  // ----- Stock & expiry adjustment -----
  const stock = Number(r.stock_quantity) || 0;
  const expiringSoonQty = Math.min(stock, Math.max(0, Number(r.expiring_soon_qty ?? 0)));
  const effectiveStock = Math.max(0, stock - expiringSoonQty);
  const hasExpiryExclusion = expiringSoonQty > 0;

  const rawMin = Number(r.minimum_stock_level) || 0;
  const globalMin = getGlobalLowStockThreshold();
  const minLevel = rawMin > 0 ? rawMin : globalMin;
  const minStockSource: SmartItem['minStockSource'] = rawMin > 0 ? 'item' : 'global';
  const belowMin = minLevel > 0 && effectiveStock < minLevel;
  const needsReorder = effectiveStock <= reorderPoint && (adc > 0 || belowMin) || belowMin;

  const target = Math.max(forecastDemand + safetyStock, minLevel);
  const suggestedReorder = needsReorder ? Math.max(1, Math.ceil(target - effectiveStock)) : 0;

  const daysRemaining = adc > 0 ? Math.round(effectiveStock / adc) : null;
  const stockOutRisk = daysRemaining !== null && daysRemaining < 7;

  let daysUntilExpiry: number | null = null;
  if (r.expiry_date) {
    daysUntilExpiry = Math.ceil((new Date(r.expiry_date).getTime() - now) / 86_400_000);
  }
  const expiryAlertLevel = calcExpiryLevel(daysUntilExpiry);
  const isDeadStock = hasSalesAggregation && q60 === 0 && stock > 0;
  const inventoryScore = calcInventoryScore({ adc, currentStock: stock, predictedDemand14: forecastDemand, daysUntilExpiry, isDeadStock });

  return {
    id: r.branch_item_id,
    name: r.name || 'Unknown',
    category: r.category || 'Uncategorized',
    currentStock: stock,
    effectiveStock,
    expiringSoonQty,
    hasExpiryExclusion,
    minStockLevel: minLevel,
    minStockSource,
    leadTimeDays,
    reorderPoint,
    forecastDays,
    expiryDate: r.expiry_date,
    sellingPrice: Number(r.selling_price) || 0,
    branchId: r.branch_id,
    adc,
    isSlowMover,
    trendMultiplier,
    trendPercent,
    trendDirection,
    predictedDemand14: forecastDemand,
    forecastDemand,
    safetyStock,
    suggestedReorder,
    needsReorder,
    daysRemaining,
    stockOutRisk,
    daysUntilExpiry,
    expiryAlertLevel,
    isDeadStock,
    lastSaleDate: r.last_sale_date,
    totalSold30Days: q30,
    inventoryScore,
    scoreLevel: getScoreLevel(inventoryScore),
  };
}

async function fetchBranchItemsFallback(branchIds: string[]): Promise<SmartItem[]> {
  const { data, error } = await supabase
    .from('branch_items')
    .select('id, medicine_id, branch_id, quantity, expiry_date, selling_price, medicines!inner(name, category, minimum_stock_level, item_type, lead_time_days)')
    .in('branch_id', branchIds)
    .order('id', { ascending: false })
    .limit(10_000);

  if (error) throw error;

  const now = Date.now();
  return ((data || []) as any[]).map((item) => {
    const med = Array.isArray(item.medicines) ? item.medicines[0] : item.medicines;
    return toSmartItem({
      branch_item_id: item.id,
      medicine_id: item.medicine_id,
      name: med?.name || 'Unknown',
      category: med?.category || 'Uncategorized',
      branch_id: item.branch_id,
      stock_quantity: item.quantity,
      minimum_stock_level: med?.minimum_stock_level || 0,
      lead_time_days: med?.lead_time_days ?? 3,
      expiry_date: item.expiry_date,
      selling_price: item.selling_price,
      item_type: med?.item_type || null,
      qty_7: 0, qty_14: 0, qty_21: 0,
      qty_30: 0, qty_60: 0,
      last_sale_date: null,
      monthly_qty: new Array(12).fill(0),
      expiring_soon_qty: 0,
    }, now, false);
  });
}

async function fetchSmartInventory(branchIds: string[]): Promise<SmartItem[]> {
  if (branchIds.length === 0) return [];

  const now = Date.now();

  try {
    const { data, error } = await (supabase as any).rpc('smart_inventory_summary', {
      _branch_ids: branchIds,
    });
    if (error) throw error;

    const rows: RpcRow[] = data || [];
    if (rows.length > 0) return rows.map((r) => toSmartItem(r, now));
  } catch (error) {
    console.warn('Smart inventory RPC unavailable; falling back to branch inventory snapshot.', error);
  }

  return fetchBranchItemsFallback(branchIds);
}

export function useSmartInventory() {
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const isPharmacy = branchType === 'pharmacy';
  const queryClient = useQueryClient();
  const { threshold: globalLowStock } = useLowStockThreshold();

  const branchIds = useMemo(() => {
    if (selectedBranch) return [selectedBranch];
    if (profile?.role === 'owner') return cachedOwnerBranchIds;
    if (profile?.branch_id) return [profile.branch_id];
    return [];
  }, [selectedBranch, profile?.role, profile?.branch_id, cachedOwnerBranchIds]);

  const enabled = !!profile && (profile.role !== 'owner' || !ownerBranchesLoading) && branchIds.length > 0;

  const queryKey = useMemo(
    () => ['smart-inventory', [...branchIds].sort().join(','), globalLowStock] as const,
    [branchIds, globalLowStock]
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSmartInventory(branchIds),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['smart-inventory'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  const items = query.data ?? [];

  const summary = useMemo(() => {
    const topDemand = [...items].filter(i => i.adc > 0).sort((a, b) => b.adc - a.adc).slice(0, 20);
    const reorderItems = items.filter(i => i.needsReorder);
    const stockOutAlerts = items.filter(i => i.stockOutRisk);
    const deadStock = items.filter(i => i.isDeadStock);
    const expiryAlerts = items.filter(i => i.expiryAlertLevel !== 'none');
    const criticalExpiry = items.filter(i => i.expiryAlertLevel === 'critical' || i.expiryAlertLevel === 'expired');
    const avgScore = items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.inventoryScore, 0) / items.length)
      : 0;
    const scoreDist = {
      excellent: items.filter(i => i.scoreLevel === 'excellent').length,
      good: items.filter(i => i.scoreLevel === 'good').length,
      risk: items.filter(i => i.scoreLevel === 'risk').length,
      critical: items.filter(i => i.scoreLevel === 'critical').length,
    };
    return { topDemand, reorderItems, stockOutAlerts, deadStock, expiryAlerts, criticalExpiry, avgScore, scoreDist, totalItems: items.length };
  }, [items]);

  return {
    items,
    summary,
    loading: ownerBranchesLoading || query.isLoading,
    error: query.error,
    isPharmacy,
    refetch: query.refetch,
  };
}
