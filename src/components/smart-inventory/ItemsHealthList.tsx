import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SmartItem } from '@/hooks/useSmartInventory';
import { Search, TrendingUp, Package, Calendar, AlertTriangle, Activity } from 'lucide-react';

interface ItemsHealthListProps {
  items: SmartItem[];
  isPharmacy: boolean;
}

const levelTone: Record<SmartItem['scoreLevel'], string> = {
  excellent: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200',
  risk: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
};

type SortKey = 'score-asc' | 'score-desc' | 'name';

export default function ItemsHealthList({ items, isPharmacy }: ItemsHealthListProps) {
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score-asc');
  const [selected, setSelected] = useState<SmartItem | null>(null);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let arr = items;
    if (ql) {
      arr = arr.filter(i =>
        i.name.toLowerCase().includes(ql) || i.category.toLowerCase().includes(ql)
      );
    }
    return [...arr].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'score-desc') return b.inventoryScore - a.inventoryScore;
      return a.inventoryScore - b.inventoryScore;
    });
  }, [items, q, sortKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Items Health Score</CardTitle>
        <CardDescription>
          Per-item health score (0–100) combining stock-vs-demand, expiry risk, sell-through and recency.
          Click a row to see the breakdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Search ${isPharmacy ? 'medicines' : 'items'}...`}
              className="pl-8 h-9"
            />
          </div>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="score-asc">Worst score first</option>
            <option value="score-desc">Best score first</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No items match.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">ADC</TableHead>
                  <TableHead className="text-right">Days left</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(it => (
                  <TableRow
                    key={it.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelected(it)}
                  >
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{it.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{it.currentStock}</TableCell>
                    <TableCell className="text-right">{it.adc.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      {it.daysRemaining !== null ? (
                        <span className={it.daysRemaining < 7 ? 'text-destructive font-semibold' : ''}>
                          {it.daysRemaining}d
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={levelTone[it.scoreLevel]}>
                        {Number(it.inventoryScore).toFixed(2)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  <Badge variant="outline" className="mr-1">{selected.category}</Badge>
                  Health breakdown
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="text-center">
                  <p className="text-5xl font-bold">{Number(selected.inventoryScore).toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">out of 100</p>
                  <Badge variant="outline" className={`mt-2 ${levelTone[selected.scoreLevel]}`}>
                    {selected.scoreLevel.toUpperCase()}
                  </Badge>
                  <Progress value={selected.inventoryScore} className="mt-3 h-2" />
                </div>

                <FactorRow
                  icon={<Package className="h-4 w-4" />}
                  label="Stock on hand"
                  value={`${selected.currentStock}`}
                  hint={selected.minStockLevel > 0 ? `min level: ${selected.minStockLevel}${selected.minStockSource === 'global' ? ' (global default)' : ' (custom)'}` : undefined}
                  warn={selected.minStockLevel > 0 && selected.currentStock < selected.minStockLevel}
                />
                <FactorRow
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Avg daily consumption (30d)"
                  value={selected.adc.toFixed(2)}
                  hint={`${selected.totalSold30Days} sold in last 30d`}
                />
                <FactorRow
                  icon={<Activity className="h-4 w-4" />}
                  label="14-day predicted demand"
                  value={Math.ceil(selected.predictedDemand14).toString()}
                  hint={selected.suggestedReorder > 0 ? `suggest reorder ≈ ${selected.suggestedReorder}` : 'sufficient stock'}
                  warn={selected.needsReorder}
                />
                <FactorRow
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Days remaining"
                  value={selected.daysRemaining !== null ? `${selected.daysRemaining}d` : '—'}
                  warn={selected.stockOutRisk}
                  hint={selected.stockOutRisk ? 'High stock-out risk (<7 days)' : undefined}
                />
                <FactorRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Days until expiry"
                  value={selected.daysUntilExpiry !== null ? `${selected.daysUntilExpiry}d` : '—'}
                  warn={selected.expiryAlertLevel === 'critical' || selected.expiryAlertLevel === 'expired'}
                  hint={selected.expiryAlertLevel !== 'none' ? selected.expiryAlertLevel.toUpperCase() : undefined}
                />
                <FactorRow
                  icon={<Activity className="h-4 w-4" />}
                  label="Last sale"
                  value={selected.lastSaleDate ? new Date(selected.lastSaleDate).toLocaleDateString() : 'never'}
                  warn={selected.isDeadStock}
                  hint={selected.isDeadStock ? 'Dead stock (no sales in 60d)' : undefined}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function FactorRow({
  icon, label, value, hint, warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${warn ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'}`}>
      <div className="flex items-start gap-2">
        <span className={warn ? 'text-destructive' : 'text-muted-foreground'}>{icon}</span>
        <div>
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        </div>
      </div>
      <p className={`text-sm font-semibold ${warn ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  );
}
