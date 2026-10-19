import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { DollarSign, Package, ShoppingCart, AlertTriangle, Download, CalendarIcon, Calendar as CalendarDaysIcon, MessageCircle, ExternalLink, Send, Tag } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { format, subDays, subWeeks, subMonths, subYears, startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/lib/db';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useToast } from '@/hooks/use-toast';
import { TelegramConnectionDialog } from '@/components/telegram/TelegramConnectionDialog';
import { useSeasonalPerformance } from '@/hooks/useSeasonalPerformance';
import SeasonalTrendsWidget from '@/components/smart-inventory/SeasonalTrendsWidget';
import ScoreOverview from '@/components/smart-inventory/ScoreOverview';
import { useSmartInventory } from '@/hooks/useSmartInventory';
import { addisDayString, addisDayOffset, addisPeriodStartDay } from '@/lib/timezone';
interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
}

interface OutOfStockItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
}

interface LowStockItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  minimum_stock_level: number;
}

interface ExpiringItem {
  id: string;
  name: string;
  category: string;
  expiry_date: string;
}

interface ExpiredItem {
  id: string;
  name: string;
  category: string;
  expiry_date: string;
}

interface PaymentMethodData {
  method: string;
  amount: number;
}

interface CategorySalesData {
  category: string;
  sales: number;
  revenue: number;
}

interface ProductPerformanceData {
  name: string;
  sales: number;
  revenue: number;
}

interface GroupSalesData {
  name: string;
  code: string;
  sales: number;
}

interface IncomeExpenseData {
  date: string;
  income: number;
  expenses: number;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const { selectedBranch, userBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const { toast } = useToast();
  const { topSeasonalThisMonth, currentMonthName } = useSeasonalPerformance();
  const { summary: smartSummary } = useSmartInventory();
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalProducts: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0
  });
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [incomeExpenseData, setIncomeExpenseData] = useState<IncomeExpenseData[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodData[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [topGroupSales, setTopGroupSales] = useState<GroupSalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('daily');
  const [customDate, setCustomDate] = useState<Date>();
  const [sendingTestMessage, setSendingTestMessage] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [reportPeriod, customDate, selectedBranch, userBranch, profile]);

  const getDateRange = () => {
    const now = new Date();
    if (customDate) {
      return { 
        start: startOfDay(customDate), 
        end: endOfDay(customDate) 
      };
    }
    
    switch (reportPeriod) {
      case 'daily': return { start: startOfDay(now), end: endOfDay(now) };
      case 'weekly': return { start: subWeeks(now, 1), end: now };
      case 'monthly': return { start: subMonths(now, 1), end: now };
      case 'yearly': return { start: subYears(now, 1), end: now };
      default: return { start: subMonths(now, 1), end: now };
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { start, end } = getDateRange();
      
      // Determine which branch to filter by (staff fixed to their branch)
      const effectiveBranchId = profile?.role === 'staff' ? userBranch : selectedBranch;

      // Owner isolation: fetch owner's branch IDs when "All Branches"
      let ownerBranchIds: string[] = [];
      if (!effectiveBranchId && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
      }

      // If owner has no branches yet, show empty data
      if (!effectiveBranchId && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setStats({ totalRevenue: 0, totalProducts: 0, todaySales: 0, lowStockItems: 0, outOfStockItems: 0, expiredItems: 0 });
        setOutOfStockItems([]); setLowStockItems([]); setExpiringItems([]); setExpiredItems([]);
        setCategorySales([]); setProductPerformance([]); setIncomeExpenseData([]); setPaymentMethodData([]);
        setTotalGroups(0); setTopGroupSales([]);
        setLoading(false);
        return;
      }
      
      // Fetch revenue for the selected period — filter by business sale_date
      // in Africa/Addis_Ababa time so "today"/"this week" match the Ethiopian
      // calendar day regardless of the browser's timezone.
      const startDay = customDate
        ? addisDayString(customDate)
        : addisPeriodStartDay(reportPeriod as any);
      const endDay = customDate ? addisDayString(customDate) : addisDayString();
      let salesQuery = supabase
        .from('sales')
        .select('total_amount, extra_profit, created_at, sale_date, payment_method, discount_amount')
        .gte('sale_date', startDay)
        .lte('sale_date', endDay);
      
      if (profile?.role === 'staff') {
        salesQuery = salesQuery.eq('branch_id', userBranch || profile?.branch_id);
      } else if (effectiveBranchId) {
        salesQuery = salesQuery.eq('branch_id', effectiveBranchId);
      } else if (ownerBranchIds.length > 0) {
        salesQuery = salesQuery.in('branch_id', ownerBranchIds);
      }
      const { data: salesData } = await salesQuery;
      
      const totalRevenue =
        salesData?.reduce(
          (sum, sale: any) => sum + Number(sale.total_amount) + Number(sale.extra_profit || 0),
          0,
        ) || 0;

      // CRITICAL: Inventory metrics MUST come from `branch_items` (per-branch stock),
      // never from `medicines` (the global master catalog). `medicines` rows can
      // outlive their `branch_items` (e.g. after a branch removal) and have no
      // meaningful `branch_id` column, so any filter applied to it is silently
      // ignored — that was the source of the "26 products" leak.
      const applyBranchFilter = (q: any) => {
        if (profile?.role === 'staff') return q.eq('branch_id', userBranch || profile?.branch_id);
        if (effectiveBranchId) return q.eq('branch_id', effectiveBranchId);
        if (ownerBranchIds.length > 0) return q.in('branch_id', ownerBranchIds);
        return q;
      };

      // Single branch_items fetch powers totals + low/out-of-stock + expiry cards.
      const branchItemsQuery = applyBranchFilter(
        supabase
          .from('branch_items')
          .select('id, quantity, expiry_date, medicines!inner(name, category, minimum_stock_level)')
          .range(0, 49999)
      );
      const { data: branchItemsData } = await branchItemsQuery;
      const biRows: any[] = branchItemsData || [];

      const totalProducts = biRows.length;
      const lowStockItems = biRows.filter((bi) =>
        bi.quantity > 0 && bi.quantity <= (bi.medicines?.minimum_stock_level ?? 0)
      ).length;
      const outOfStockItems = biRows.filter((bi) => bi.quantity === 0).length;

      // Fetch sales count for the selected period
      const periodSalesQuery = applyBranchFilter(
        supabase
          .from('sales')
          .select('id')
          .gte('sale_date', startDay)
          .lte('sale_date', endDay)
      );
      const { data: periodSalesData } = await periodSalesQuery;
      const todaySales = periodSalesData?.length || 0;

      // Derive inventory alert lists from the same branch_items snapshot.
      const outOfStockDetails = biRows
        .filter((bi) => bi.quantity === 0)
        .map((bi) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          stock_quantity: 0,
        }));

      const lowStockDetails = biRows
        .filter((bi) => bi.quantity > 0 && bi.quantity <= (bi.medicines?.minimum_stock_level ?? 0))
        .map((bi) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          stock_quantity: bi.quantity,
          minimum_stock_level: bi.medicines?.minimum_stock_level ?? 0,
        }));

      const todayStr = addisDayString();
      const thirtyStr = addisDayOffset(30);

      // Pull batch-level expiry data (the real source of truth — items can have
      // multiple batches with different expiry dates).
      let batchesQuery = supabase
        .from('inventory_batches')
        .select('branch_item_id, expiry_date, remaining_quantity, branch_id, medicines!inner(name, category)')
        .gt('remaining_quantity', 0)
        .not('expiry_date', 'is', null)
        .range(0, 49999);
      batchesQuery = applyBranchFilter(batchesQuery);
      const { data: batchesData } = await batchesQuery;
      const batchRows: any[] = batchesData || [];

      // Build maps keyed by branch_item_id to dedupe (count one entry per item,
      // using its earliest at-risk batch).
      const expiringMap = new Map<string, any>();
      const expiredMap = new Map<string, any>();
      batchRows.forEach((b) => {
        const ed = b.expiry_date;
        const target = ed <= todayStr ? expiredMap : (ed <= thirtyStr ? expiringMap : null);
        if (!target) return;
        const existing = target.get(b.branch_item_id);
        if (!existing || ed < existing.expiry_date) {
          target.set(b.branch_item_id, {
            id: b.branch_item_id,
            name: b.medicines?.name || 'Unknown',
            category: b.medicines?.category || '',
            expiry_date: ed,
          });
        }
      });

      // Also include legacy branch_items rows that have an expiry but no batch
      // entry (older data created before batches existed).
      biRows.forEach((bi) => {
        if (!bi.expiry_date || bi.quantity <= 0) return;
        if (expiringMap.has(bi.id) || expiredMap.has(bi.id)) return;
        const entry = {
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          expiry_date: bi.expiry_date,
        };
        if (bi.expiry_date <= todayStr) expiredMap.set(bi.id, entry);
        else if (bi.expiry_date <= thirtyStr) expiringMap.set(bi.id, entry);
      });

      const expiringDetails = Array.from(expiringMap.values());
      const expiredDetails = Array.from(expiredMap.values());

      // Fetch sales data with medicine details for charts (include strip sales)
      const { data: salesWithItems } = await (function(){
        let salesWithItemsQuery = supabase
          .from('sales')
          .select(`
            *,
            sale_items (
              quantity,
              medicine_id,
              sale_type,
              stripes_sold,
              total_price,
              medicines (name, category, medicine_code_id)
            )
          `)
          .gte('sale_date', startDay)
          .lte('sale_date', endDay);
        
        if (profile?.role === 'staff') {
          salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', userBranch || profile?.branch_id);
        } else if (effectiveBranchId) {
          salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', effectiveBranchId);
        } else if (ownerBranchIds.length > 0) {
          salesWithItemsQuery = salesWithItemsQuery.in('branch_id', ownerBranchIds);
        }
        return salesWithItemsQuery;
      })();

      // Process category sales data — include both pack and strip sales
      const categoryMap = new Map<string, { sales: number; revenue: number }>();
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
            // For strip sales, stripes_sold is stored as thousandths in DB
            const soldQty = item.sale_type === 'by_stripe'
              ? (item.stripes_sold ? item.stripes_sold / 1000 : item.quantity)
              : (item.quantity || 0);
            const itemRevenue = Number(item.total_price || 0);
            categoryMap.set(category, {
              sales: existing.sales + soldQty,
              revenue: existing.revenue + itemRevenue
            });
          }
        });
      });

      const categorySalesArray = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      // Process product performance data — include both pack and strip sales
      const productMap = new Map<string, { sales: number; revenue: number }>();
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const name = item.medicines.name;
            const existing = productMap.get(name) || { sales: 0, revenue: 0 };
            const soldQty = item.sale_type === 'by_stripe'
              ? (item.stripes_sold ? item.stripes_sold / 1000 : item.quantity)
              : (item.quantity || 0);
            const itemRevenue = Number(item.total_price || 0);
            productMap.set(name, {
              sales: existing.sales + soldQty,
              revenue: existing.revenue + itemRevenue
            });
          }
        });
      });

      const productPerformanceArray = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

      // Fetch custom expenses for income vs expense chart
      const { data: expensesData } = await (function(){
        let expensesQuery = supabase
          .from('expenses')
          .select('amount, created_at')
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString());
        
        if (profile?.role === 'staff') {
          expensesQuery = expensesQuery.eq('branch_id', userBranch || profile?.branch_id);
        } else if (effectiveBranchId) {
          expensesQuery = expensesQuery.eq('branch_id', effectiveBranchId);
        } else if (ownerBranchIds.length > 0) {
          expensesQuery = expensesQuery.in('branch_id', ownerBranchIds);
        }
        return expensesQuery;
      })();

      // Income vs Expenses chart uses ONLY operating expenses. Inventory
      // batch purchases are Cost of Goods (COGS), not operating expenses, and
      // are reported separately on the Finance page.

      // Process income vs expense data by day
      const dateMap = new Map<string, { income: number; expenses: number }>();
      salesWithItems?.forEach(sale => {
        // Group by business sale_date when present; fall back to created_at.
        const date = format(new Date((sale as any).sale_date || sale.created_at), 'yyyy-MM-dd');
        const existing = dateMap.get(date) || { income: 0, expenses: 0 };
        dateMap.set(date, {
          ...existing,
          income: existing.income + Number(sale.total_amount) + Number((sale as any).extra_profit || 0)
        });
      });

      // Add custom (operating) expenses only
      expensesData?.forEach(expense => {
        const date = format(new Date(expense.created_at), 'yyyy-MM-dd');
        const existing = dateMap.get(date) || { income: 0, expenses: 0 };
        dateMap.set(date, {
          ...existing,
          expenses: existing.expenses + Number(expense.amount)
        });
      });



      const incomeExpenseArray = Array.from(dateMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Process payment method data — total_amount is stored net of discount,
      // so don't subtract discount again. Include extra_profit (tips).
      const paymentMap = new Map<string, number>();
      salesData?.forEach(sale => {
        const method = sale.payment_method || 'Cash';
        const amount = Number(sale.total_amount) + Number((sale as any).extra_profit || 0);
        paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
      });

      const paymentMethodArray = Array.from(paymentMap.entries()).map(([method, amount]) => ({
        method: method,
        amount: amount
      }));

      // Fetch medicine codes (groups) for owner scope
      // medicine_codes belongs to profiles through owner_id; using the wrong
      // owner column makes Supabase return no rows, so group cards/charts stay 0.
      let codesQuery = supabase.from('medicine_codes').select('id, code, label');
      if (profile?.role === 'owner' && profile?.id) {
        codesQuery = codesQuery.eq('owner_id', profile.id);
      }
      const { data: codesData } = await codesQuery;
      const codeMap = new Map<string, { code: string; label: string }>();
      (codesData || []).forEach((c: any) => codeMap.set(c.id, { code: c.code, label: c.label }));

      // Count distinct sales transactions per group within date range
      const groupSalesIds = new Map<string, Set<string>>();
      salesWithItems?.forEach((sale: any) => {
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
      const topGroupSalesArr: GroupSalesData[] = Array.from(groupSalesIds.entries())
        .map(([cid, ids]) => ({
          name: codeMap.get(cid)?.label || codeMap.get(cid)?.code || 'Unknown',
          code: codeMap.get(cid)?.code || '',
          sales: ids.size,
        }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 7);

      setStats({
        totalRevenue,
        totalProducts,
        todaySales,
        lowStockItems,
        outOfStockItems,
        expiredItems: expiredDetails?.length || 0
      });
      setOutOfStockItems(outOfStockDetails || []);
      setLowStockItems(lowStockDetails || []);
      setExpiringItems(expiringDetails || []);
      setExpiredItems(expiredDetails || []);
      setCategorySales(categorySalesArray);
      setProductPerformance(productPerformanceArray);
      setIncomeExpenseData(incomeExpenseArray);
      setPaymentMethodData(paymentMethodArray);
      setTotalGroups((codesData || []).length);
      setTopGroupSales(topGroupSalesArr);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = async (itemId: string) => {
    try {
      // itemId is now a `branch_items.id` (per-branch stock row). Zero out the
      // per-branch quantity instead of touching the global `medicines` master.
      const { error } = await supabase
        .from('branch_items')
        .update({ quantity: 0 })
        .eq('id', itemId);

      if (error) throw error;

      setExpiredItems(expiredItems.filter(item => item.id !== itemId));
      fetchDashboardData();
    } catch (error) {
      console.error('Error updating expired item:', error);
    }
  };

  const exportToExcel = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'StockXpert';
    const ws = wb.addWorksheet('Dashboard Report');

    // Column widths
    ws.columns = [
      { width: 22 },
      { width: 18 },
      { width: 18 },
    ];

    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1E6F3E' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const subHeaderFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2D8B55' } };
    const evenRowFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF0F9F4' } };
    const borderStyle = { style: 'thin' as const, color: { argb: 'FFD0D5DD' } };
    const borders = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };

    // --- Title ---
    const titleRow = ws.addRow(['Dashboard Report']);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FF1E6F3E' } };
    ws.mergeCells('A1:C1');
    titleRow.getCell(1).alignment = { horizontal: 'center' };

    const dateRow = ws.addRow([`Generated: ${format(new Date(), 'MMMM d, yyyy')}`]);
    dateRow.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    ws.mergeCells('A2:C2');
    dateRow.getCell(1).alignment = { horizontal: 'center' };

    ws.addRow([]);

    // --- Summary Metrics ---
    const metricsHeader = ws.addRow(['Metric', 'Value']);
    metricsHeader.eachCell(cell => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = borders;
      cell.alignment = { horizontal: 'center' };
    });

    const metrics = [
      ['Total Revenue', `ETB ${stats.totalRevenue.toFixed(2)}`],
      ['Total Products', stats.totalProducts],
      [`${reportPeriod.charAt(0).toUpperCase() + reportPeriod.slice(1)} Sales`, stats.todaySales],
      ['Low Stock Items', stats.lowStockItems],
      ['Out of Stock Items', stats.outOfStockItems],
    ];

    metrics.forEach((row, i) => {
      const r = ws.addRow(row);
      r.eachCell(cell => {
        cell.border = borders;
        cell.alignment = { horizontal: 'center' };
        if (i % 2 === 0) cell.fill = evenRowFill;
      });
      // Bold metric name
      r.getCell(1).font = { bold: true, size: 10 };
    });

    ws.addRow([]);

    // --- Category Sales ---
    if (categorySales.length > 0) {
      const catHeader = ws.addRow(['Category Sales']);
      catHeader.font = { bold: true, size: 12, color: { argb: 'FF1E6F3E' } };
      ws.mergeCells(`A${catHeader.number}:C${catHeader.number}`);

      const catColHeader = ws.addRow(['Category', 'Units Sold', 'Revenue']);
      catColHeader.eachCell(cell => {
        cell.fill = subHeaderFill;
        cell.font = headerFont;
        cell.border = borders;
        cell.alignment = { horizontal: 'center' };
      });

      categorySales.forEach((cat, i) => {
        const r = ws.addRow([cat.category, cat.sales, `ETB ${cat.revenue.toFixed(2)}`]);
        r.eachCell(cell => {
          cell.border = borders;
          cell.alignment = { horizontal: 'center' };
          if (i % 2 === 0) cell.fill = evenRowFill;
        });
      });

      ws.addRow([]);
    }

    // --- Top Products ---
    if (productPerformance.length > 0) {
      const prodTitle = ws.addRow(['Top Products']);
      prodTitle.font = { bold: true, size: 12, color: { argb: 'FF1E6F3E' } };
      ws.mergeCells(`A${prodTitle.number}:C${prodTitle.number}`);

      const prodHeader = ws.addRow(['Product Name', 'Sales Count', 'Revenue']);
      prodHeader.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = borders;
        cell.alignment = { horizontal: 'center' };
      });

      productPerformance.forEach((p, i) => {
        const r = ws.addRow([p.name, p.sales, `ETB ${p.revenue.toFixed(2)}`]);
        r.eachCell(cell => {
          cell.border = borders;
          cell.alignment = { horizontal: 'center' };
          if (i % 2 === 0) cell.fill = evenRowFill;
        });
        r.getCell(1).alignment = { horizontal: 'left' };
      });

      ws.addRow([]);
    }

    // --- Payment Methods ---
    if (paymentMethodData.length > 0) {
      const payTitle = ws.addRow(['Payment Methods']);
      payTitle.font = { bold: true, size: 12, color: { argb: 'FF1E6F3E' } };
      ws.mergeCells(`A${payTitle.number}:C${payTitle.number}`);

      const payHeader = ws.addRow(['Method', 'Amount']);
      payHeader.eachCell(cell => {
        cell.fill = subHeaderFill;
        cell.font = headerFont;
        cell.border = borders;
        cell.alignment = { horizontal: 'center' };
      });

      paymentMethodData.forEach((p, i) => {
        const r = ws.addRow([p.method, `ETB ${p.amount.toFixed(2)}`]);
        r.eachCell(cell => {
          cell.border = borders;
          cell.alignment = { horizontal: 'center' };
          if (i % 2 === 0) cell.fill = evenRowFill;
        });
      });
    }

    // Generate and download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${isPharmacy ? 'pharmacy' : 'inventory'}-dashboard-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleConnectTelegram = () => {
    const botUrl = `https://t.me/haysem_bot?start=${profile?.id}`;
    window.open(botUrl, '_blank');
    toast({
      title: "Connect to Telegram Bot",
      description: "Please open the bot and click Start to complete your connection.",
      duration: 6000,
    });
  };

  const handleTestMessage = async () => {
    setSendingTestMessage(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-test-message', {
        body: { userId: profile?.id }
      });

      if (error) throw error;

      toast({
        title: "Test Message Sent! 🎉",
        description: "Check your Telegram for the confirmation message.",
      });
    } catch (error) {
      console.error('Error sending test message:', error);
      toast({
        title: "Error",
        description: "Failed to send test message. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSendingTestMessage(false);
    }
  };

  if (!profile) {
    return <div>Loading...</div>;
  }

  if (loading) {
  return (
    <div className="space-y-6">
      {profile?.role === 'owner' && <TelegramConnectionDialog />}
      <div className="flex items-center justify-between">
        <div>
            <Skeleton className="h-9 w-48 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const COLORS = [
    'hsl(217 91% 60%)',     // Blue
    'hsl(142 76% 36%)',     // Green  
    'hsl(38 92% 50%)',      // Orange
    'hsl(0 84% 60%)',       // Red
    'hsl(271 81% 56%)',     // Purple
    'hsl(191 95% 45%)',     // Cyan
    'hsl(49 96% 53%)',      // Yellow
    'hsl(340 82% 52%)',     // Pink
  ];

  return (
    <div className="space-y-6 min-w-0">
      {profile?.role === 'owner' && <TelegramConnectionDialog />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Welcome back, {profile.full_name}! Here's what's happening {isPharmacy ? 'at your pharmacy' : 'in your inventory'}.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {profile?.role === 'owner' && !profile?.telegram_chat_id && (
            <Button 
              onClick={handleConnectTelegram}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Connect Telegram</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          <Select value={reportPeriod} onValueChange={setReportPeriod}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-auto justify-start text-left font-normal">
                <CalendarIcon className="mr-1 h-4 w-4" />
                {customDate ? format(customDate, "PP") : <span>Date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={setCustomDate}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          
          <Button onClick={exportToExcel} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Excel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {profile?.role === 'owner' && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ETB {stats.totalRevenue.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">All time revenue</p>
            </CardContent>
          </Card>
        )}
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">Products in inventory</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Period Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.todaySales}</div>
            <p className="text-xs text-muted-foreground">Sales transactions this period</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.lowStockItems}</div>
            <p className="text-xs text-muted-foreground">Low stock items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <Package className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.outOfStockItems}</div>
            <p className="text-xs text-muted-foreground">Items out of stock</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Expiring Soon' : 'Items Near Expiry'}</CardTitle>
            <CalendarDaysIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{expiringItems.length}</div>
            <p className="text-xs text-muted-foreground">Items expiring in 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Expired Medicines' : 'Expired Items'}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.expiredItems}</div>
            <p className="text-xs text-muted-foreground">{isPharmacy ? 'Medicines expired' : 'Items expired'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Medicine Groups' : 'Item Groups'}</CardTitle>
            <Tag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalGroups}</div>
            <p className="text-xs text-muted-foreground">Total {isPharmacy ? 'medicine' : 'item'} codes</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Items Sold by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Items Sold by Category</CardTitle>
            <CardDescription>Sales breakdown by {isPharmacy ? 'medicine' : 'item'} category</CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden p-2 sm:p-6 pt-0 sm:pt-0">
                <ChartContainer
                  config={{
                    sales: { label: "Sales", color: "hsl(217 91% 60%)" }
                  }}
                  className="h-[300px] w-full"
                >
                  <BarChart data={categorySales} margin={{ left: -20, right: 8, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sales">
                      {categorySales.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
          </CardContent>
        </Card>

        {/* Payment Methods Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>Revenue breakdown by payment method</CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden p-2 sm:p-6 pt-0 sm:pt-0">
                <ChartContainer
                  config={{
                    amount: { label: "Amount", color: "hsl(142 76% 36%)" }
                  }}
                  className="h-[300px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={paymentMethodData}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      fill="hsl(142 76% 36%)"
                      dataKey="amount"
                      label={false}
                      nameKey="method"
                    >
                      {paymentMethodData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {paymentMethodData.map((entry, index) => (
                    <div key={entry.method} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span>{entry.method}: ETB {entry.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
          </CardContent>
        </Card>

        {/* Top-Selling Groups (medicine codes) */}
        <Card>
          <CardHeader>
            <CardTitle>Top-Selling {isPharmacy ? 'Medicine' : 'Item'} Groups</CardTitle>
            <CardDescription>Sales transactions per group (top 7)</CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden p-2 sm:p-6 pt-0 sm:pt-0">
            {topGroupSales.length > 0 ? (
              <>
                <ChartContainer
                  config={{ sales: { label: "Sales", color: "hsl(271 81% 56%)" } }}
                  className="h-[300px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={topGroupSales}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="sales"
                      nameKey="name"
                      label={false}
                    >
                      {topGroupSales.map((_, index) => (
                        <Cell key={`gcell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {topGroupSales.map((entry, index) => (
                    <div key={entry.code || entry.name} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="truncate max-w-[200px]">
                        {entry.name}
                        {entry.code && entry.code !== entry.name ? ` (${entry.code})` : ''} — {entry.sales}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[300px] flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1 px-4">
                <p className="font-medium text-foreground">No grouped sales yet</p>
                <p className="text-xs">
                  {totalGroups === 0
                    ? 'Create medicine codes and assign items to start tracking group sales here.'
                    : 'Assign items to your medicine codes, then sell them — group sales appear once linked items are sold in this date range.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <SeasonalTrendsWidget
          topItems={topSeasonalThisMonth}
          currentMonthName={currentMonthName}
          isPharmacy={isPharmacy}
        />

        {/* Health Score */}
        <ScoreOverview
          scoreDist={smartSummary.scoreDist}
          avgScore={smartSummary.avgScore}
          totalItems={smartSummary.totalItems}
        />
      </div>

      {/* Top Selling Products Chart - Moved Below */}
      <Card>
        <CardHeader>
          <CardTitle>Top Selling {isPharmacy ? 'Products' : 'Items'}</CardTitle>
          <CardDescription>Most frequently sold {isPharmacy ? 'products' : 'items'}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden p-2 sm:p-6 pt-0 sm:pt-0">
              <ChartContainer
                config={{
                  sales: { label: "Sales", color: "hsl(38 92% 50%)" }
                }}
                className="h-[300px] w-full"
              >
                <PieChart>
                  <Pie
                    data={productPerformance.slice(0, 5)}
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    fill="hsl(38 92% 50%)"
                    dataKey="sales"
                    label={false}
                    nameKey="name"
                  >
                    {productPerformance.slice(0, 5).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {productPerformance.slice(0, 5).map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-1 text-xs">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span>{entry.name} ({entry.sales})</span>
                  </div>
                ))}
              </div>
        </CardContent>
      </Card>

      {/* Income vs Expenses Chart - Only show for owners */}
      {profile?.role === 'owner' && (
        <Card>
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
            <CardDescription>Daily comparison of income and expenses</CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden p-2 sm:p-6 pt-0 sm:pt-0">
                <ChartContainer
                  config={{
                    income: { label: "Income", color: "hsl(var(--success))" },
                    expenses: { label: "Expenses", color: "hsl(var(--destructive))" }
                  }}
                  className="h-[350px] w-full"
                >
                  <LineChart data={incomeExpenseData} margin={{ left: -20, right: 8, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} width={45} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="income"
                      name="Income"
                      stroke="hsl(142, 76%, 36%)" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="expenses"
                      name="Expenses"
                      stroke="hsl(0, 84%, 60%)" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ChartContainer>
                <div className="mt-2 flex gap-4 justify-center text-xs">
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(142, 76%, 36%)' }} /><span>Income</span></div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(0, 84%, 60%)' }} /><span>Expenses</span></div>
                </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}