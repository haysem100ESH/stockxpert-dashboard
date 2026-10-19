import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';

export interface SupplierScore {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  // Metrics
  totalPurchases: number;
  totalSpent: number;
  avgOrderValue: number;
  creditPurchases: number;
  paidPurchases: number;
  totalDebt: number;
  // Scores (0-100)
  priceScore: number;
  deliveryScore: number;
  accuracyScore: number;
  availabilityScore: number;
  overallScore: number;
  scoreLevel: 'excellent' | 'good' | 'average' | 'risky';
  // Items supplied
  itemsSupplied: string[];
  // Dependence
  purchaseShare: number; // percentage of total purchases
}

export interface ItemPriceComparison {
  medicineId: string;
  medicineName: string;
  category: string;
  suppliers: {
    supplierId: string;
    supplierName: string;
    price: number;
    lastUpdated: string;
  }[];
  bestPrice: number;
  bestSupplierId: string;
  bestSupplierName: string;
  priceRange: number;
}

export interface SupplierRecommendation {
  medicineId: string;
  medicineName: string;
  suggestedReorder: number;
  bestSupplierId: string;
  bestSupplierName: string;
  bestPrice: number;
  estimatedCost: number;
  supplierScore: number;
  reason: string;
}

function calcScoreLevel(score: number): SupplierScore['scoreLevel'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'average';
  return 'risky';
}

export function useSupplierIntelligence() {
  const [supplierScores, setSupplierScores] = useState<SupplierScore[]>([]);
  const [priceComparisons, setPriceComparisons] = useState<ItemPriceComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds } = useOwnerBranchIds();
  const isPharmacy = branchType === 'pharmacy';

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
        setSupplierScores([]);
        setPriceComparisons([]);
        setLoading(false);
        return;
      }

      // Fetch suppliers
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id, name, contact_person, phone, email')
        .in('branch_id', branchIds);

      // Fetch all purchases
      const { data: purchases } = await supabase
        .from('supplier_purchases')
        .select('id, supplier_id, item_name, quantity, unit_cost, total_cost, payment_type, created_at')
        .in('branch_id', branchIds);

      // Fetch supplier debts
      const { data: debts } = await supabase
        .from('supplier_debts')
        .select('supplier_id, total_debt')
        .in('branch_id', branchIds);

      // Fetch item prices from supplier_item_prices
      const { data: itemPrices } = await supabase
        .from('supplier_item_prices')
        .select('supplier_id, medicine_id, price, last_updated');

      // Fetch medicines for name mapping
      const { data: medicines } = await supabase
        .from('medicines')
        .select('id, name, category')
        .in('branch_id', branchIds);

      const debtMap: Record<string, number> = {};
      (debts || []).forEach((d: any) => { debtMap[d.supplier_id] = Number(d.total_debt); });

      const medicineMap: Record<string, { name: string; category: string }> = {};
      (medicines || []).forEach((m: any) => { medicineMap[m.id] = { name: m.name, category: m.category || 'Uncategorized' }; });

      const supplierMap: Record<string, string> = {};
      (suppliers || []).forEach((s: any) => { supplierMap[s.id] = s.name; });

      const totalAllPurchases = (purchases || []).reduce((s: number, p: any) => s + Number(p.total_cost), 0);

      // Calculate supplier scores
      const scores: SupplierScore[] = (suppliers || []).map((supplier: any) => {
        const supplierPurchases = (purchases || []).filter((p: any) => p.supplier_id === supplier.id);
        const totalSpent = supplierPurchases.reduce((s: number, p: any) => s + Number(p.total_cost), 0);
        const totalPurchaseCount = supplierPurchases.length;
        const avgOrderValue = totalPurchaseCount > 0 ? totalSpent / totalPurchaseCount : 0;
        const creditCount = supplierPurchases.filter((p: any) => p.payment_type === 'credit').length;
        const paidCount = supplierPurchases.filter((p: any) => p.payment_type === 'paid').length;
        const debt = debtMap[supplier.id] || 0;

        // Items supplied (unique)
        const itemsSet = new Set(supplierPurchases.map((p: any) => p.item_name));
        const itemsSupplied = Array.from(itemsSet);

        // Price Score: lower avg unit cost = higher score (compare to global avg)
        const allUnitCosts = (purchases || []).map((p: any) => Number(p.unit_cost));
        const globalAvgCost = allUnitCosts.length > 0 ? allUnitCosts.reduce((a: number, b: number) => a + b, 0) / allUnitCosts.length : 0;
        const supplierAvgCost = supplierPurchases.length > 0
          ? supplierPurchases.reduce((s: number, p: any) => s + Number(p.unit_cost), 0) / supplierPurchases.length
          : globalAvgCost;
        const priceRatio = globalAvgCost > 0 ? supplierAvgCost / globalAvgCost : 1;
        const priceScore = Math.max(0, Math.min(100, Math.round(100 - (priceRatio - 0.5) * 100)));

        // Delivery Score: based on frequency and recency
        const now = new Date();
        const recentPurchases = supplierPurchases.filter((p: any) => {
          const diff = (now.getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24);
          return diff <= 90;
        });
        const deliveryScore = Math.min(100, Math.round(
          totalPurchaseCount > 0
            ? (recentPurchases.length / Math.max(1, totalPurchaseCount)) * 80 + (totalPurchaseCount >= 5 ? 20 : totalPurchaseCount * 4)
            : 0
        ));

        // Accuracy Score: paid ratio (fewer credit/debt = more reliable)
        const accuracyScore = totalPurchaseCount > 0
          ? Math.round((paidCount / totalPurchaseCount) * 100)
          : 50;

        // Availability Score: number of different items supplied
        const availabilityScore = Math.min(100, itemsSupplied.length * 15 + 30);

        // Overall weighted score
        const overallScore = Math.round(
          priceScore * 0.3 + deliveryScore * 0.25 + accuracyScore * 0.25 + availabilityScore * 0.2
        );

        return {
          id: supplier.id,
          name: supplier.name,
          contactPerson: supplier.contact_person,
          phone: supplier.phone,
          email: supplier.email,
          totalPurchases: totalPurchaseCount,
          totalSpent,
          avgOrderValue,
          creditPurchases: creditCount,
          paidPurchases: paidCount,
          totalDebt: debt,
          priceScore,
          deliveryScore,
          accuracyScore,
          availabilityScore,
          overallScore,
          scoreLevel: calcScoreLevel(overallScore),
          itemsSupplied,
          purchaseShare: totalAllPurchases > 0 ? Math.round((totalSpent / totalAllPurchases) * 100) : 0,
        };
      });

      scores.sort((a, b) => b.overallScore - a.overallScore);
      setSupplierScores(scores);

      // Build price comparisons from supplier_item_prices
      const pricesByItem: Record<string, ItemPriceComparison['suppliers']> = {};
      (itemPrices || []).forEach((ip: any) => {
        const medInfo = medicineMap[ip.medicine_id];
        if (!medInfo) return;
        if (!pricesByItem[ip.medicine_id]) pricesByItem[ip.medicine_id] = [];
        pricesByItem[ip.medicine_id].push({
          supplierId: ip.supplier_id,
          supplierName: supplierMap[ip.supplier_id] || 'Unknown',
          price: Number(ip.price),
          lastUpdated: ip.last_updated,
        });
      });

      const comparisons: ItemPriceComparison[] = Object.entries(pricesByItem)
        .filter(([_, suppliers]) => suppliers.length > 0)
        .map(([medicineId, suppliers]) => {
          const sorted = [...suppliers].sort((a, b) => a.price - b.price);
          const med = medicineMap[medicineId];
          return {
            medicineId,
            medicineName: med?.name || 'Unknown',
            category: med?.category || 'Uncategorized',
            suppliers: sorted,
            bestPrice: sorted[0].price,
            bestSupplierId: sorted[0].supplierId,
            bestSupplierName: sorted[0].supplierName,
            priceRange: sorted.length > 1 ? sorted[sorted.length - 1].price - sorted[0].price : 0,
          };
        })
        .sort((a, b) => b.suppliers.length - a.suppliers.length);

      setPriceComparisons(comparisons);
    } catch (error) {
      console.error('Error fetching supplier intelligence:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranch, profile, cachedOwnerBranchIds]);

  // Dependence risks: suppliers with >40% share
  const dependenceRisks = useMemo(() =>
    supplierScores.filter(s => s.purchaseShare > 40),
    [supplierScores]
  );

  // Risky suppliers
  const riskySuppliers = useMemo(() =>
    supplierScores.filter(s => s.scoreLevel === 'risky'),
    [supplierScores]
  );

  // Get best supplier for a given medicine
  const getBestSupplierForItem = (medicineId: string): { supplierId: string; supplierName: string; price: number; score: number } | null => {
    const comparison = priceComparisons.find(c => c.medicineId === medicineId);
    if (!comparison) return null;

    // Rank by combined price + score
    const ranked = comparison.suppliers.map(s => {
      const scoreData = supplierScores.find(ss => ss.id === s.supplierId);
      const score = scoreData?.overallScore || 50;
      // Normalize: lower price is better, higher score is better
      const priceNorm = comparison.bestPrice > 0 ? comparison.bestPrice / s.price : 1;
      const combined = priceNorm * 0.6 + (score / 100) * 0.4;
      return { ...s, score, combined };
    }).sort((a, b) => b.combined - a.combined);

    if (ranked.length === 0) return null;
    return {
      supplierId: ranked[0].supplierId,
      supplierName: ranked[0].supplierName,
      price: ranked[0].price,
      score: ranked[0].score,
    };
  };

  return {
    supplierScores,
    priceComparisons,
    dependenceRisks,
    riskySuppliers,
    loading,
    isPharmacy,
    refetch: fetchData,
    getBestSupplierForItem,
  };
}
