/**
 * MedicineCodeAnalytics
 * Top-demand cards + bar / pie / line charts for medicine-code groups.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import { useMedicineCodeSales, type SalesRange } from '@/hooks/useMedicineCodeAnalytics';
import type { MedicineCode } from '@/hooks/useMedicineCodes';

const PIE_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(var(--muted-foreground))',
  'hsl(var(--destructive))',
  'hsl(var(--secondary-foreground))',
];

interface Props {
  codes: MedicineCode[];
  medicineIdToCodeId: Map<string, string | null>;
}

export default function MedicineCodeAnalytics({ codes, medicineIdToCodeId }: Props) {
  const [range, setRange] = useState<SalesRange>('weekly');
  const { perCode, trend, loading } = useMedicineCodeSales(range, medicineIdToCodeId);

  const codeMap = useMemo(() => {
    const m = new Map<string, MedicineCode>();
    codes.forEach((c) => m.set(c.id, c));
    return m;
  }, [codes]);

  const top5Qty = useMemo(
    () => [...perCode].sort((a, b) => b.totalQty - a.totalQty).slice(0, 5)
      .map((p) => ({
        code: codeMap.get(p.codeId)?.code || '—',
        label: codeMap.get(p.codeId)?.label || '',
        qty: p.totalQty,
      })),
    [perCode, codeMap],
  );

  const top5Revenue = useMemo(
    () => perCode.slice(0, 5).map((p) => ({
      code: codeMap.get(p.codeId)?.code || '—',
      label: codeMap.get(p.codeId)?.label || '',
      revenue: p.totalRevenue,
    })),
    [perCode, codeMap],
  );

  const trendData = useMemo(() => trend.map((t) => ({ ...t })), [trend]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Top Demand & Revenue</CardTitle>
          <Tabs value={range} onValueChange={(v) => setRange(v as SalesRange)}>
            <TabsList>
              <TabsTrigger value="daily">Today</TabsTrigger>
              <TabsTrigger value="weekly">7 days</TabsTrigger>
              <TabsTrigger value="monthly">30 days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading analytics…</div>
        ) : perCode.length === 0 ? (
          <div className="text-sm text-muted-foreground">No sales in this period.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* BAR: top 5 by quantity */}
              <div>
                <div className="text-sm font-medium mb-2">Top Selling Code Groups (Quantity)</div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top5Qty} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* PIE: revenue distribution */}
              <div>
                <div className="text-sm font-medium mb-2">Revenue Distribution</div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={top5Revenue}
                        dataKey="revenue"
                        nameKey="code"
                        outerRadius={85}
                        label={(d: any) => d.code}
                      >
                        {top5Revenue.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(v: any) => Number(v).toFixed(2)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* LINE: trend */}
            <div>
              <div className="text-sm font-medium mb-2">Sales Trend</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="qty" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(var(--accent-foreground))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
