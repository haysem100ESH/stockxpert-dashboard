import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Loader2 } from 'lucide-react';
import { SmartItem } from '@/hooks/useSmartInventory';
import { supabase } from '@/lib/db';

interface ExpiryRiskPanelProps {
  items: SmartItem[];
}

type Level = 'expired' | 'critical' | 'risk' | 'warning';

const alertConfig: Record<Level, { label: string; variant: 'destructive' | 'secondary' | 'outline'; bg: string }> = {
  expired: { label: 'Expired', variant: 'destructive', bg: 'bg-red-50 dark:bg-red-950/20' },
  critical: { label: '<30 Days', variant: 'destructive', bg: 'bg-red-50/70 dark:bg-red-950/10' },
  risk: { label: '<60 Days', variant: 'secondary', bg: 'bg-amber-50 dark:bg-amber-950/10' },
  warning: { label: '<90 Days', variant: 'outline', bg: 'bg-yellow-50 dark:bg-yellow-950/10' },
};

interface BatchRow {
  id: string;
  branch_item_id: string;
  batch_number: string | null;
  remaining_quantity: number;
  expiry_date: string;
  daysUntilExpiry: number;
  level: Level;
}

function calcLevel(days: number): Level | null {
  if (days <= 0) return 'expired';
  if (days < 30) return 'critical';
  if (days < 60) return 'risk';
  if (days < 90) return 'warning';
  return null;
}

export default function ExpiryRiskPanel({ items }: ExpiryRiskPanelProps) {
  const branchItemIds = useMemo(() => items.map(i => i.id), [items]);
  const nameByItemId = useMemo(() => {
    const m = new Map<string, { name: string; category: string }>();
    items.forEach(i => m.set(i.id, { name: i.name, category: i.category }));
    return m;
  }, [items]);

  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (branchItemIds.length === 0) { setBatches([]); return; }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('inventory_batches')
        .select('id, branch_item_id, batch_number, remaining_quantity, expiry_date')
        .in('branch_item_id', branchItemIds)
        .not('expiry_date', 'is', null)
        .gt('remaining_quantity', 0);
      if (cancelled) return;
      const now = Date.now();
      const rows: BatchRow[] = ((data || []) as any[])
        .map(b => {
          const days = Math.ceil((new Date(b.expiry_date).getTime() - now) / 86_400_000);
          const lvl = calcLevel(days);
          return lvl ? {
            id: b.id,
            branch_item_id: b.branch_item_id,
            batch_number: b.batch_number,
            remaining_quantity: Number(b.remaining_quantity),
            expiry_date: b.expiry_date,
            daysUntilExpiry: days,
            level: lvl,
          } : null;
        })
        .filter((b): b is BatchRow => b !== null);
      setBatches(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [branchItemIds]);

  // Group batches by level, then by parent item
  const grouped = useMemo(() => {
    const out: Record<Level, Map<string, BatchRow[]>> = {
      expired: new Map(), critical: new Map(), risk: new Map(), warning: new Map(),
    };
    for (const b of batches) {
      const m = out[b.level];
      const list = m.get(b.branch_item_id) || [];
      list.push(b);
      m.set(b.branch_item_id, list);
    }
    // Sort batches within each parent by soonest expiring first
    (Object.keys(out) as Level[]).forEach(lvl => {
      out[lvl].forEach(list => list.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry));
    });
    return out;
  }, [batches]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-red-500" />
          Expiry Risk Detection
        </CardTitle>
        <CardDescription>
          Per-batch expiry tracking, grouped by item
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : batches.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No expiry risks detected. All batches are within safe expiry dates.
          </p>
        ) : (
          <div className="space-y-6">
            {(Object.keys(grouped) as Level[]).map((level) => {
              const parents = grouped[level];
              if (parents.size === 0) return null;
              const config = alertConfig[level];
              const batchCount = Array.from(parents.values()).reduce((s, l) => s + l.length, 0);

              return (
                <div key={level}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {parents.size} item{parents.size !== 1 ? 's' : ''} • {batchCount} batch{batchCount !== 1 ? 'es' : ''}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {Array.from(parents.entries()).map(([itemId, list]) => {
                      const meta = nameByItemId.get(itemId);
                      return (
                        <div key={itemId} className={`border rounded-lg overflow-hidden ${config.bg}`}>
                          <div className="px-3 py-2 border-b bg-background/60">
                            <p className="font-medium text-sm">{meta?.name || 'Unknown item'}</p>
                            <p className="text-xs text-muted-foreground">{meta?.category} • {list.length} batch{list.length !== 1 ? 'es' : ''} in alert</p>
                          </div>
                          <div className="divide-y">
                            {list.map(b => (
                              <div key={b.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-muted-foreground shrink-0">└─</span>
                                  <span className="font-mono text-xs truncate">
                                    {b.batch_number || <span className="italic text-muted-foreground">no batch #</span>}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-right shrink-0">
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(b.expiry_date).toLocaleDateString()} • Stock: {b.remaining_quantity}
                                  </span>
                                  <Badge variant={config.variant} className="text-[10px]">
                                    {b.daysUntilExpiry <= 0
                                      ? `Expired ${Math.abs(b.daysUntilExpiry)}d ago`
                                      : `${b.daysUntilExpiry}d left`}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
