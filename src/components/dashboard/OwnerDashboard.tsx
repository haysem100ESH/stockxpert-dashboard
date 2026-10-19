import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DollarSign, 
  Package, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Users,
  FileText,
  ShoppingCart,
  MessageCircle,
  ExternalLink,
  Send,
  CreditCard,
  Tag
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import StaffInventoryWithActions from '@/components/inventory/StaffInventoryWithActions';
import SalesManagement from '@/components/sales/SalesManagement';
import FinanceManagement from '@/components/finance/FinanceManagement';
import SupplierManagement from '@/components/suppliers/SupplierManagement';
import StaffManagement from '@/components/staff/StaffManagement';
import ExpiredMedicinesTable from './ExpiredMedicinesTable';
import LowStockItemsTable from './LowStockItemsTable';

import SubscriptionPlanCard from '@/components/subscription/SubscriptionPlanCard';
import { TelegramConnectionDialog } from '@/components/telegram/TelegramConnectionDialog';
import { getCreditLimit, getCreditScoreLabel } from '@/hooks/useCreditScore';
import { useSeasonalPerformance } from '@/hooks/useSeasonalPerformance';
import SeasonalTrendsWidget from '@/components/smart-inventory/SeasonalTrendsWidget';
import ScoreOverview from '@/components/smart-inventory/ScoreOverview';
import { useSmartInventory } from '@/hooks/useSmartInventory';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { useDashboardStats, type DateFilter } from '@/hooks/useDashboardStats';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
  totalSoldItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
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

interface PaymentMethodData {
  method: string;
  amount: number;
}

export default function OwnerDashboard() {
  const [sendingTestMessage, setSendingTestMessage] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('daily');
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const { profile } = useAuth();
  const isPharmacy = branchType === 'pharmacy';
  const { topSeasonalThisMonth, currentMonthName, isPharmacy: seasonalIsPharmacy } = useSeasonalPerformance();
  const { summary: smartSummary } = useSmartInventory();

  // TanStack Query–cached overview data (instant hydration on revisit / filter change).
  const { data: overview, loading } = useDashboardStats(dateFilter);
  const {
    stats,
    categorySales,
    medicinesCategorySales,
    itemsCategorySales,
    productPerformance,
    topMedicines,
    topItems,
    paymentMethodData,
    creditOverview,
    totalGroups,
    topGroupSales,
  } = overview;

  const handleConnectTelegram = () => {
    window.open('https://t.me/pharmaXpertbot', '_blank');
    toast({
      title: "Connect to Telegram Bot",
      description: "Please open the bot in your Telegram app and click Start to complete your connection.",
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Owner Dashboard</h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
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

  return (
    <div className="space-y-6 min-w-0">
      <TelegramConnectionDialog />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">{isPharmacy ? 'Pharmacy Dashboard' : 'Inventory Dashboard'}</h1>
        
        <div className="flex items-center gap-4">
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">ETB {stats.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Total sales revenue
            </p>
          </CardContent>
        </Card>

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
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Total Items' : 'Total Products'}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isPharmacy ? stats.totalItems : stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">{isPharmacy ? 'Non-medicine items' : 'Products in stock'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sold Items</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSoldItems}</div>
            <p className="text-xs text-muted-foreground">
              Total items sold
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.lowStockItems}</div>
            <p className="text-xs text-muted-foreground">
              Items need restock
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <Package className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.outOfStockItems || 0}</div>
            <p className="text-xs text-muted-foreground">
              Items out of stock
            </p>
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

        {(
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{isPharmacy ? 'Medicine Groups' : 'Item Groups'}</CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalGroups}</div>
              <p className="text-xs text-muted-foreground">Total medicine codes</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap w-full h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Medicines Sold by Category - pharmacy only */}
            {isPharmacy && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Medicines Sold by Category</CardTitle>
                  <CardDescription>Medicine sales performance</CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                  {medicinesCategorySales.length === 0 ? (
                    <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                      No data available for the selected period
                    </div>
                  ) : (
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
                  )}
                </CardContent>
              </Card>
            )}

            {/* Items Sold by Category */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>{isPharmacy ? 'Non-medicine items sales' : 'Sales breakdown by category'}</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                {((isPharmacy ? itemsCategorySales : categorySales).length === 0) ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                    No data available for the selected period
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <div style={{ minWidth: 280 }}>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={isPharmacy ? itemsCategorySales : categorySales} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                          <YAxis tick={{ fontSize: 11 }} width={40} />
                          <Bar dataKey="sales" fill="hsl(var(--secondary))" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top-Selling Medicines - pharmacy only */}
            {isPharmacy && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Top-Selling Medicines</CardTitle>
                  <CardDescription>Best performing medicines</CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                  {topMedicines.length === 0 ? (
                    <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                      No data available for the selected period
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Top-Selling Items */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-Selling Items</CardTitle>
                <CardDescription>{isPharmacy ? 'Best performing items' : 'Best performing products'}</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                {((isPharmacy ? topItems : productPerformance).length === 0) ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                    No data available for the selected period
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={(isPharmacy ? topItems : productPerformance).slice(0, 5)} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--accent))" dataKey="sales" label={false} nameKey="name">
                          {(isPharmacy ? topItems : productPerformance).slice(0, 5).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap gap-2 justify-center">
                      {(isPharmacy ? topItems : productPerformance).slice(0, 5).map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-1 text-xs">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 90) % 360}, 65%, 55%)` }} />
                          <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Top-Selling Groups (medicine codes) */}
            <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Top-Selling Groups</CardTitle>
                  <CardDescription>Sales transactions per medicine code</CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                  {topGroupSales.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={topGroupSales.slice(0, 6)} cx="50%" cy="50%" outerRadius="55%" dataKey="sales" nameKey="name" label={false}>
                            {topGroupSales.slice(0, 6).map((_, index) => (
                              <Cell key={`gcell-${index}`} fill={`hsl(${(index * 55 + 200) % 360}, 65%, 55%)`} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-2 flex flex-wrap gap-2 justify-center">
                        {topGroupSales.slice(0, 6).map((entry, index) => (
                          <div key={entry.code || entry.name} className="flex items-center gap-1 text-xs">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 55 + 200) % 360}, 65%, 55%)` }} />
                            <span className="truncate max-w-[140px]">{entry.name} ({entry.sales})</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="h-[220px] flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1 px-4">
                      <p className="font-medium text-foreground">No data available for the selected period</p>
                      <p className="text-xs">
                        {totalGroups === 0
                          ? 'Create medicine codes and assign items to start tracking group sales here.'
                          : 'No grouped sales fall inside this date range.'}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

            {/* Payment Methods */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Revenue by payment method</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                {paymentMethodData.length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                    No data available for the selected period
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={paymentMethodData} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--accent))" dataKey="amount" label={false} nameKey="method">
                          {paymentMethodData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap gap-2 justify-center">
                      {paymentMethodData.map((entry, index) => (
                        <div key={entry.method} className="flex items-center gap-1 text-xs">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 90) % 360}, 65%, 55%)` }} />
                          <span>{entry.method}: ETB {Number(entry.amount).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>


            {/* Seasonal Trends */}
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

            {/* Credit Score Overview */}
            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle>Credit Score Overview</CardTitle>
                  <CardDescription>Customer credit health snapshot</CardDescription>
                </div>
                <CreditCard className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Avg Score</p>
                    <p className={`text-2xl font-bold ${creditOverview.avgScore >= 80 ? 'text-green-600' : creditOverview.avgScore >= 50 ? 'text-yellow-600' : creditOverview.avgScore >= 30 ? 'text-orange-500' : 'text-red-600'}`}>
                      {creditOverview.avgScore}
                    </p>
                    <p className="text-xs text-muted-foreground">{getCreditScoreLabel(creditOverview.avgScore)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">At Risk (Score &lt; 30)</p>
                    <p className="text-2xl font-bold text-destructive">{creditOverview.atRisk}</p>
                    <p className="text-xs text-muted-foreground">of {creditOverview.totalCustomers} customers</p>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Total Credit Exposure</p>
                    <p className="text-xl font-bold">ETB {creditOverview.totalExposure.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Outstanding debt across all customers</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Frequently used actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <Plus className="h-5 w-5" />
                    {isPharmacy ? 'Add Medicine' : 'Add Item'}
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <ShoppingCart className="h-5 w-5" />
                    New Sale
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <Users className="h-5 w-5" />
                    Manage Staff
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <FileText className="h-5 w-5" />
                    Reports
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <StaffInventoryWithActions />
        </TabsContent>

        <TabsContent value="sales">
          <SalesManagement />
        </TabsContent>

        <TabsContent value="finance">
          <FinanceManagement />
        </TabsContent>

        <TabsContent value="suppliers">
          <SupplierManagement />
        </TabsContent>

        <TabsContent value="staff">
          <StaffManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}