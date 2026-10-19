import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useBranding } from '@/hooks/useBranding';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, ShoppingCart, AlertTriangle, Download, Calendar as CalendarDaysIcon } from 'lucide-react';
import { format, startOfDay, endOfDay, subWeeks, subMonths, subYears } from 'date-fns';
import { supabase } from '@/lib/db';
import { addisDayString, addisPeriodStartDay } from '@/lib/timezone';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// Use explicit types with type assertions to avoid complex inference
type SimpleStats = {
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
  periodSalesRevenue: number;
  expiredItems: number;
};

type SimpleItem = {
  id: string;
  name: string;
  category: string;
  stock_quantity?: number;
  minimum_stock_level?: number;
  expiry_date?: string;
};

type CategorySalesData = {
  category: string;
  sales: number;
  revenue: number;
};

type ProductData = {
  name: string;
  sales: number;
  revenue: number;
};

export default function StaffDashboard() {
  const { profile } = useAuth();
  const { userBranch, branchType } = useBranchContext();
  const branding = useBranding();
  const isPharmacy = branchType === 'pharmacy';
  
  const [stats, setStats] = useState<SimpleStats>({
    totalProducts: 0,
    totalMedicines: 0,
    totalItems: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    periodSalesRevenue: 0,
    expiredItems: 0
  });
  
  const [outOfStockItems, setOutOfStockItems] = useState<SimpleItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<SimpleItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<SimpleItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<SimpleItem[]>([]);
  const [medicinesCategorySales, setMedicinesCategorySales] = useState<CategorySalesData[]>([]);
  const [itemsCategorySales, setItemsCategorySales] = useState<CategorySalesData[]>([]);
  const [topMedicines, setTopMedicines] = useState<ProductData[]>([]);
  const [topItems, setTopItems] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('daily');
  const [customDate, setCustomDate] = useState<Date>();

  useEffect(() => {
    fetchDashboardData();
  }, [reportPeriod, customDate, userBranch]);

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
      const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
      
      // Fetch branch_items with medicine details for inventory stats
      let branchItemsQuery = supabase
        .from('branch_items')
        .select('id, quantity, expiry_date, medicines!inner(name, category, minimum_stock_level)');
      
      if (userBranch) {
        branchItemsQuery = branchItemsQuery.eq('branch_id', userBranch);
      }
      
      const branchItemsResult = await branchItemsQuery;
      const branchItemsData = branchItemsResult.data as any[] || [];

      // Date range in Africa/Addis_Ababa timezone so "today" matches the
      // current Ethiopian calendar day for staff regardless of browser TZ.
      const startDay = customDate
        ? addisDayString(customDate)
        : addisPeriodStartDay(reportPeriod as any);
      const endDay = customDate ? addisDayString(customDate) : addisDayString();

      let salesQuery = supabase
        .from('sales')
        .select('id, total_amount, extra_profit, payment_method, discount_amount')
        .gte('sale_date', startDay)
        .lte('sale_date', endDay);
      
      if (userBranch) {
        salesQuery = salesQuery.eq('branch_id', userBranch);
      }
      
      const salesResult = await salesQuery;
      const salesData = salesResult.data as any[] || [];

      // Fetch sales with items for charts
      let salesWithItemsQuery = supabase
        .from('sales')
        .select(`
          *,
          sale_items (
            quantity,
            medicine_id,
            medicines (name, category)
          )
        `)
        .gte('sale_date', startDay)
        .lte('sale_date', endDay);
      
      if (userBranch) {
        salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', userBranch);
      }
      
      const { data: salesWithItems } = await salesWithItemsQuery;

      // Process category sales data
      const medicineCategoryMap = new Map<string, { sales: number; revenue: number }>();
      const itemCategoryMap = new Map<string, { sales: number; revenue: number }>();
      
      salesWithItems?.forEach((sale: any) => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const isMedicine = medicineCategories.includes(category);
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);

            if (isMedicine) {
              const medExisting = medicineCategoryMap.get(category) || { sales: 0, revenue: 0 };
              medicineCategoryMap.set(category, {
                sales: medExisting.sales + item.quantity,
                revenue: medExisting.revenue + itemRevenue
              });
            } else {
              const itemExisting = itemCategoryMap.get(category) || { sales: 0, revenue: 0 };
              itemCategoryMap.set(category, {
                sales: itemExisting.sales + item.quantity,
                revenue: itemExisting.revenue + itemRevenue
              });
            }
          }
        });
      });

      const medicinesCategorySalesArray = Array.from(medicineCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      const itemsCategorySalesArray = Array.from(itemCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      // Process product performance
      const productMap = new Map<string, { sales: number; revenue: number; category: string }>();
      salesWithItems?.forEach((sale: any) => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const name = item.medicines.name;
            const category = item.medicines.category;
            const existing = productMap.get(name) || { sales: 0, revenue: 0, category };
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);
            productMap.set(name, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + itemRevenue,
              category
            });
          }
        });
      });

      const topMedicinesArray = Array.from(productMap.entries())
        .filter(([_, data]) => medicineCategories.includes(data.category))
        .map(([name, data]) => ({ name, sales: data.sales, revenue: data.revenue }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

      const topItemsArray = Array.from(productMap.entries())
        .filter(([_, data]) => !medicineCategories.includes(data.category))
        .map(([name, data]) => ({ name, sales: data.sales, revenue: data.revenue }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

      // Derive inventory alerts from branch_items
      const outOfStockData: SimpleItem[] = branchItemsData
        .filter((bi: any) => bi.quantity === 0)
        .map((bi: any) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
        }));

      const lowStockData: SimpleItem[] = branchItemsData
        .filter((bi: any) => bi.quantity > 0 && bi.medicines?.minimum_stock_level && bi.quantity <= bi.medicines.minimum_stock_level)
        .map((bi: any) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          stock_quantity: bi.quantity,
          minimum_stock_level: bi.medicines?.minimum_stock_level,
        }));

      const today = addisDayString();
      const tomorrowStr = addisDayString(new Date(Date.now() + 86_400_000));
      const thirtyStr = addisDayString(new Date(Date.now() + 30 * 86_400_000));

      const expiringData: SimpleItem[] = branchItemsData
        .filter((bi: any) => bi.expiry_date && bi.quantity > 0 && bi.expiry_date >= tomorrowStr && bi.expiry_date <= thirtyStr)
        .map((bi: any) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          expiry_date: bi.expiry_date,
        }));

      const expiredData: SimpleItem[] = branchItemsData
        .filter((bi: any) => bi.expiry_date && bi.quantity > 0 && bi.expiry_date <= today)
        .map((bi: any) => ({
          id: bi.id,
          name: bi.medicines?.name || 'Unknown',
          category: bi.medicines?.category || '',
          expiry_date: bi.expiry_date,
        }));

      const totalProducts = branchItemsData.length;
      const totalMedicines = branchItemsData.filter((bi: any) => medicineCategories.includes(bi.medicines?.category)).length;
      const totalItems = branchItemsData.filter((bi: any) => !medicineCategories.includes(bi.medicines?.category)).length;
      const lowStockItemsCount = lowStockData.length;
      const outOfStockItemsCount = outOfStockData.length;
      // Period sales revenue includes extra_profit (tips / kept change) so it
      // matches the total cash actually received from customers.
      const periodSalesRevenue = salesData.reduce(
        (sum: number, sale: any) => sum + Number(sale.total_amount) + Number(sale.extra_profit || 0),
        0,
      );

      setStats({
        totalProducts,
        totalMedicines,
        totalItems,
        todaySales: salesData.length,
        lowStockItems: lowStockItemsCount,
        outOfStockItems: outOfStockItemsCount,
        periodSalesRevenue,
        expiredItems: expiredData.length
      });
      
      setOutOfStockItems(outOfStockData);
      setLowStockItems(lowStockData);
      setExpiringItems(expiringData);
      setExpiredItems(expiredData);
      setMedicinesCategorySales(medicinesCategorySalesArray);
      setItemsCategorySales(itemsCategorySalesArray);
      setTopMedicines(topMedicinesArray);
      setTopItems(topItemsArray);
      
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = async (itemId: string) => {
    try {
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

  const exportToCSV = () => {
    const csvContent = [
      ['Metric', 'Value'],
      ['Total Products', stats.totalProducts.toString()],
      ['Period Sales', stats.todaySales.toString()],
      ['Low Stock Items', stats.lowStockItems.toString()],
      ['Out of Stock Items', stats.outOfStockItems.toString()]
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-dashboard-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (!profile) {
    return <div>Loading...</div>;
  }

  if (loading) {
    return <div>Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Staff Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Welcome back, {profile.full_name}!
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
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
          
          <Button onClick={exportToCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isPharmacy && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Medicines</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalMedicines}</div>
              <p className="text-xs text-muted-foreground">Medicines in stock</p>
            </CardContent>
          </Card>
        )}
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isPharmacy ? stats.totalItems : stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">{isPharmacy ? 'Non-medicine items' : 'Items in stock'}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Period Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">ETB {stats.periodSalesRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Sales revenue this period</p>
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
      </div>

      {stats.outOfStockItems > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Out of Stock Products</span>
            </CardTitle>
            <CardDescription>
              {stats.outOfStockItems} products are currently out of stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {outOfStockItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              ))}
              {outOfStockItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {outOfStockItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-warning" />
              <span>Low Stock Items</span>
            </CardTitle>
            <CardDescription>
              {lowStockItems.length} items are running low on stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {lowStockItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="outline">Low Stock</Badge>
                </div>
              ))}
              {lowStockItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {lowStockItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {expiredItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>{isPharmacy ? 'Expired Medicines' : 'Expired Items'}</span>
            </CardTitle>
            <CardDescription>
              {expiredItems.length} {isPharmacy ? 'medicines' : 'items'} have expired and need attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiredItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">Expires: {item.expiry_date}</p>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => handleRemoveExpiredItem(item.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {expiredItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {expiredItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isPharmacy ? (
          <>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Medicines Sold by Category</CardTitle>
                <CardDescription>Sales breakdown by medicine category</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <div className="w-full overflow-x-auto">
                  <div style={{ minWidth: 280 }}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={medicinesCategorySales} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} width={40} />
                        <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>Non-medicine items sales</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <div className="w-full overflow-x-auto">
                  <div style={{ minWidth: 280 }}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={itemsCategorySales} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} width={40} />
                        <Bar dataKey="sales" fill="hsl(var(--secondary))" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-Selling Medicines</CardTitle>
                <CardDescription>Best performing medicines</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={topMedicines.slice(0, 5)} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--primary))" dataKey="sales" label={false} nameKey="name">
                      {topMedicines.slice(0, 5).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 72) % 360}, 70%, 50%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {topMedicines.slice(0, 5).map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 72) % 360}, 70%, 50%)` }} />
                      <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-Selling Items</CardTitle>
                <CardDescription>Best performing items</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={topItems.slice(0, 5)} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--accent))" dataKey="sales" label={false} nameKey="name">
                      {topItems.slice(0, 5).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {topItems.slice(0, 5).map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 90) % 360}, 65%, 55%)` }} />
                      <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>Sales breakdown by item category</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <div className="w-full overflow-x-auto">
                  <div style={{ minWidth: 280 }}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={[...medicinesCategorySales, ...itemsCategorySales]} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} width={40} />
                        <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-Selling Items</CardTitle>
                <CardDescription>Best performing items</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={[...topMedicines, ...topItems].sort((a, b) => b.sales - a.sales).slice(0, 5)}
                      cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--primary))" dataKey="sales" label={false} nameKey="name"
                    >
                      {[...topMedicines, ...topItems].sort((a, b) => b.sales - a.sales).slice(0, 5).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 72) % 360}, 70%, 50%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {[...topMedicines, ...topItems].sort((a, b) => b.sales - a.sales).slice(0, 5).map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 72) % 360}, 70%, 50%)` }} />
                      <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}