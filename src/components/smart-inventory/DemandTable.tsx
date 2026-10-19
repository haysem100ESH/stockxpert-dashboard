import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SmartItem } from '@/hooks/useSmartInventory';
import { TrendIndicator } from './TrendIndicator';


interface DemandTableProps {
  items: SmartItem[];
  allItems: SmartItem[];
  isPharmacy: boolean;
}

export default function DemandTable({ items, allItems, isPharmacy }: DemandTableProps) {
  const label = isPharmacy ? 'medicines' : 'items';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Demanded {isPharmacy ? 'Medicines' : 'Items'}</CardTitle>
        <CardDescription>
          Highest average daily consumption based on last 30 days of sales
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No sales data yet to calculate demand.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">ADC (WMA)</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead className="text-right">Forecast Demand</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Days Left</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{item.adc.toFixed(2)}</TableCell>
                    <TableCell><TrendIndicator item={item} /></TableCell>
                    <TableCell className="text-right">
                      {Math.ceil(item.forecastDemand)}
                      <span className="text-[10px] text-muted-foreground ml-1">/{item.forecastDays}d</span>
                    </TableCell>
                    <TableCell className="text-right">{item.currentStock}</TableCell>
                    <TableCell className="text-right">
                      {item.daysRemaining !== null ? (
                        <span className={item.daysRemaining < 7 ? 'text-destructive font-semibold' : ''}>
                          {item.daysRemaining}d
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge score={item.inventoryScore} level={item.scoreLevel} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Summary stats */}
        <div className="mt-4 grid grid-cols-3 gap-4">
          <StatCard label={`Total ${label} tracked`} value={allItems.length} />
          <StatCard label="With sales (30d)" value={allItems.filter(i => i.totalSold30Days > 0).length} />
          <StatCard label="No recent sales" value={allItems.filter(i => i.totalSold30Days === 0).length} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBadge({ score, level }: { score: number; level: SmartItem['scoreLevel'] }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    excellent: 'default',
    good: 'secondary',
    risk: 'outline',
    critical: 'destructive',
  };
  return (
    <Badge variant={variants[level]} className="text-xs">
      {score}
    </Badge>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
