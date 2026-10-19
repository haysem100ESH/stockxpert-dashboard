import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { chunkedInPartial } from '@/lib/supabaseBatch';

export interface MonthlyData {
  month: number; // 1-12
  monthName: string;
  quantity: number;
  frequency: number;
}

export interface SeasonalItem {
  id: string;
  name: string;
  category: string;
  monthly: MonthlyData[];
  peakMonth: number;
  peakMonthName: string;
  peakQuantity: number;
  yearlyTotal: number;
  yearlyAvg: number;
  seasonalStrengths: number[]; // 12 values, percentage vs avg
  insight: string | null;
  currentMonthStrength: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function generateInsight(item: SeasonalItem): string | null {
  if (item.yearlyTotal === 0) return null;

  const peakStrength = item.seasonalStrengths[item.peakMonth - 1];
  if (peakStrength < 130) return null; // Not significant enough

  // Find consecutive strong months
  const strongMonths: number[] = [];
  item.seasonalStrengths.forEach((s, i) => {
    if (s >= 120) strongMonths.push(i + 1);
  });

  const strongMonthNames = strongMonths.map(m => MONTH_NAMES[m - 1]);

  if (strongMonths.length === 1) {
    const prepMonth = strongMonths[0] === 1 ? 12 : strongMonths[0] - 1;
    return `${item.name} demand peaks in ${MONTH_NAMES[strongMonths[0] - 1]} (${Math.round(peakStrength)}% of average). Suggested action: increase stock before ${MONTH_NAMES[prepMonth - 1]}.`;
  }

  if (strongMonths.length <= 3) {
    const firstStrong = strongMonths[0];
    const prepMonth = firstStrong === 1 ? 12 : firstStrong - 1;
    return `${item.name} demand increases in ${strongMonthNames.join(' and ')}. Suggested action: increase stock before ${MONTH_NAMES[prepMonth - 1]}.`;
  }

  return `${item.name} has seasonal demand across ${strongMonths.length} months, peaking in ${item.peakMonthName} at ${Math.round(peakStrength)}% of average.`;
}

export function useSeasonalPerformance() {
  const [items, setItems] = useState<SeasonalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds } = useOwnerBranchIds();
  const isPharmacy = branchType === 'pharmacy';
  const currentMonth = new Date().getMonth() + 1; // 1-12

  const fetchData = async () => {
    if (!profile) return;
    setLoading(true);

    try {
      let branchIds: string[] = [];
      if (selectedBranch) {
        branchIds = [selectedBranch];
      } else if (profile.role === 'owner' && profile.id) {
        branchIds = cachedOwnerBranchIds;
      } else if (profile.branch_id) {
        branchIds = [profile.branch_id];
      }

      if (branchIds.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      // Fetch branch_items for the selected branches, then resolve master catalog
      // (medicines) details. The legacy `medicines.branch_id` column is null for
      // master catalog items, which is why the previous direct query returned [].
      const { data: branchItems } = await supabase
        .from('branch_items')
        .select('medicine_id, branch_id')
        .in('branch_id', branchIds);

      const medIds = [...new Set((branchItems || []).map((bi: any) => bi.medicine_id).filter(Boolean))] as string[];
      if (medIds.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      const medicineBatchSize = 20;
      console.log(`[Supabase batching] medicines id/name/category by id: ${Math.ceil(medIds.length / medicineBatchSize)} batches for ${medIds.length} ids`);
      const { data: medicines } = await chunkedInPartial<any>(medIds, (ids) =>
        supabase
          .from('medicines')
          .select('id, name, category')
          .in('id', ids)
      , medicineBatchSize);

      if (!medicines || medicines.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      // Fetch all historical sales (up to 12 months back), scoped to the branches.
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const sinceDay = oneYearAgo.toISOString().slice(0, 10);
      const { data: salesData } = await supabase
        .from('sale_items')
        .select('medicine_id, pack_quantity, strip_quantity, quantity, created_at, sales!inner(branch_id, sale_date, created_at)')
        .in('sales.branch_id', branchIds)
        .gte('sales.sale_date', sinceDay);

      // Build monthly sales map: medicine_id -> month -> { qty, freq }
      const monthlyMap: Record<string, Record<number, { qty: number; freq: number }>> = {};

      (salesData || []).forEach((sale: any) => {
        const id = sale.medicine_id;
        // Prefer the business sale_date for grouping; fall back to created_at.
        const saleDate = new Date(sale.sales?.sale_date || sale.sales?.created_at || sale.created_at);
        const month = saleDate.getMonth() + 1; // 1-12
        // Support both legacy `quantity` column and pack/strip split
        const packStripQty = (sale.pack_quantity || 0) + (sale.strip_quantity || 0);
        const qty = packStripQty > 0 ? packStripQty : (sale.quantity || 0);

        if (!monthlyMap[id]) monthlyMap[id] = {};
        if (!monthlyMap[id][month]) monthlyMap[id][month] = { qty: 0, freq: 0 };

        monthlyMap[id][month].qty += qty;
        monthlyMap[id][month].freq += 1;
      });

      // Build seasonal items
      const seasonalItems: SeasonalItem[] = medicines.map((med: any) => {
        const monthData = monthlyMap[med.id] || {};

        const monthly: MonthlyData[] = Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const data = monthData[m] || { qty: 0, freq: 0 };
          return {
            month: m,
            monthName: SHORT_MONTHS[i],
            quantity: data.qty,
            frequency: data.freq,
          };
        });

        const yearlyTotal = monthly.reduce((sum, m) => sum + m.quantity, 0);
        const yearlyAvg = yearlyTotal / 12;

        const seasonalStrengths = monthly.map(m =>
          yearlyAvg > 0 ? (m.quantity / yearlyAvg) * 100 : 0
        );

        let peakMonth = 1;
        let peakQuantity = 0;
        monthly.forEach(m => {
          if (m.quantity > peakQuantity) {
            peakQuantity = m.quantity;
            peakMonth = m.month;
          }
        });

        const currentMonthStrength = seasonalStrengths[currentMonth - 1] || 0;

        const item: SeasonalItem = {
          id: med.id,
          name: med.name,
          category: med.category || 'Uncategorized',
          monthly,
          peakMonth,
          peakMonthName: MONTH_NAMES[peakMonth - 1],
          peakQuantity,
          yearlyTotal,
          yearlyAvg,
          seasonalStrengths,
          insight: null,
          currentMonthStrength,
        };

        item.insight = generateInsight(item);
        return item;
      });

      // Sort by yearly total descending
      seasonalItems.sort((a, b) => b.yearlyTotal - a.yearlyTotal);
      setItems(seasonalItems);
    } catch (error) {
      console.error('Error fetching seasonal data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch, profile?.id, profile?.role, profile?.branch_id, cachedOwnerBranchIds]);

  const topSeasonalThisMonth = useMemo(() => {
    return items
      .filter(i => i.currentMonthStrength >= 120 && i.yearlyTotal > 0)
      .sort((a, b) => b.currentMonthStrength - a.currentMonthStrength)
      .slice(0, 5);
  }, [items]);

  const insights = useMemo(() => {
    return items.filter(i => i.insight !== null).slice(0, 10);
  }, [items]);

  return {
    items,
    loading,
    isPharmacy,
    currentMonth,
    currentMonthName: MONTH_NAMES[currentMonth - 1],
    topSeasonalThisMonth,
    insights,
    refetch: fetchData,
  };
}

// Export seasonal multiplier function for demand prediction integration
export function getSeasonalMultiplier(
  monthlyQuantities: number[]
): number {
  const currentMonth = new Date().getMonth(); // 0-11
  const total = monthlyQuantities.reduce((s, q) => s + q, 0);
  if (total === 0) return 1;
  const avg = total / 12;
  if (avg === 0) return 1;
  const currentQty = monthlyQuantities[currentMonth] || 0;
  const strength = currentQty / avg;
  // Clamp between 0.5 and 2.0
  return Math.max(0.5, Math.min(2.0, strength));
}
