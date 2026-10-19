import { useSmartInventory } from '@/hooks/useSmartInventory';
import { useSeasonalPerformance } from '@/hooks/useSeasonalPerformance';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Package,
  ShoppingCart,
  Skull,
  CalendarDays,
  BarChart3,
  RefreshCw,
  Sun,
  Bell,
  Layers,
  HeartPulse,

} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import ScoreOverview from './ScoreOverview';
import DemandTable from './DemandTable';
import ReorderSuggestions from './ReorderSuggestions';
import StockOutAlerts from './StockOutAlerts';
import DeadStockList from './DeadStockList';
import ExpiryRiskPanel from './ExpiryRiskPanel';
import SeasonalPerformance from './SeasonalPerformance';
import SeasonalInsights from './SeasonalInsights';
import SeasonalTrendsWidget from './SeasonalTrendsWidget';
import InventoryDashboard from '@/components/inventory/InventoryDashboard';
import BatchAnalytics from '@/components/inventory/BatchAnalytics';
import HealthScoreInfoDialog from './HealthScoreInfoDialog';
import ItemsHealthList from './ItemsHealthList';

export default function SmartInventoryDashboard() {
  const { items, summary, loading, error, isPharmacy, refetch } = useSmartInventory();
  const seasonal = useSeasonalPerformance();
  const { branchType } = useBranchContext();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-muted-foreground text-lg">Analyzing inventory intelligence...</span>
      </div>
    );
  }

  const labelItem = isPharmacy ? 'Medicine' : 'Item';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Smart Inventory Intelligence</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered demand prediction & inventory health analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthScoreInfoDialog isPharmacy={isPharmacy} />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Smart Inventory could not load branch stock. Please refresh after checking inventory table access.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard
          icon={<Package className="h-5 w-5" />}
          label={`Total ${labelItem}s`}
          value={summary.totalItems}
          color="text-primary"
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Need Reorder"
          value={summary.reorderItems.length}
          color="text-amber-500"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Stock-Out Risk"
          value={summary.stockOutAlerts.length}
          color="text-destructive"
        />
        <SummaryCard
          icon={<Skull className="h-5 w-5" />}
          label="Dead Stock"
          value={summary.deadStock.length}
          color="text-orange-500"
        />
        {isPharmacy && (
          <SummaryCard
            icon={<CalendarDays className="h-5 w-5" />}
            label="Expiry Alerts"
            value={summary.expiryAlerts.length}
            color="text-red-500"
          />
        )}
        <SummaryCard
          icon={<BarChart3 className="h-5 w-5" />}
          label="Health Score"
          value={`${summary.avgScore}%`}
          color={summary.avgScore >= 60 ? 'text-green-500' : 'text-destructive'}
        />
      </div>

      {/* Score Overview + Seasonal Widget */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ScoreOverview scoreDist={summary.scoreDist} avgScore={summary.avgScore} totalItems={summary.totalItems} />
        </div>
        <SeasonalTrendsWidget
          topItems={seasonal.topSeasonalThisMonth}
          currentMonthName={seasonal.currentMonthName}
          isPharmacy={isPharmacy}
        />
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="alerts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-9 h-auto">
          <TabsTrigger value="alerts" className="gap-1">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-1">
            <HeartPulse className="h-4 w-4" />
            <span className="hidden sm:inline">Health</span>
          </TabsTrigger>
          <TabsTrigger value="demand" className="gap-1">
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Demand</span>
          </TabsTrigger>
          <TabsTrigger value="reorder" className="gap-1">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Reorder</span>
            {summary.reorderItems.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs h-5 px-1.5">
                {summary.reorderItems.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="stockout" className="gap-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Stock-Out</span>
            {summary.stockOutAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs h-5 px-1.5">
                {summary.stockOutAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deadstock" className="gap-1">
            <Skull className="h-4 w-4" />
            <span className="hidden sm:inline">Dead Stock</span>
          </TabsTrigger>
          <TabsTrigger value="seasonal" className="gap-1">
            <Sun className="h-4 w-4" />
            <span className="hidden sm:inline">Seasonal</span>
          </TabsTrigger>
          <TabsTrigger value="batches" className="gap-1">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Batches</span>
          </TabsTrigger>
          {isPharmacy && (
            <TabsTrigger value="expiry" className="gap-1">
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">Expiry</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="alerts">
          <InventoryDashboard />
        </TabsContent>
        <TabsContent value="health">
          <ItemsHealthList items={items} isPharmacy={isPharmacy} />
        </TabsContent>
        <TabsContent value="demand">
          <DemandTable items={summary.topDemand} allItems={items} isPharmacy={isPharmacy} />
        </TabsContent>
        <TabsContent value="reorder">
          <ReorderSuggestions items={summary.reorderItems} isPharmacy={isPharmacy} />
        </TabsContent>
        <TabsContent value="stockout">
          <StockOutAlerts items={summary.stockOutAlerts} isPharmacy={isPharmacy} />
        </TabsContent>
        <TabsContent value="deadstock">
          <DeadStockList items={summary.deadStock} isPharmacy={isPharmacy} />
        </TabsContent>
        <TabsContent value="seasonal" className="space-y-6">
          <SeasonalInsights insights={seasonal.insights} currentMonthName={seasonal.currentMonthName} />
          <SeasonalPerformance
            items={seasonal.items}
            isPharmacy={isPharmacy}
            currentMonth={seasonal.currentMonth}
            loading={seasonal.loading}
            refetch={seasonal.refetch}
          />
        </TabsContent>
        <TabsContent value="batches">
          <BatchAnalytics />
        </TabsContent>
        {isPharmacy && (
          <TabsContent value="expiry">
            <ExpiryRiskPanel items={items} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={color}>{icon}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
