import { SeasonalItem } from '@/hooks/useSeasonalPerformance';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';

interface SeasonalItemChartProps {
  item: SeasonalItem;
  currentMonth: number;
}

export default function SeasonalItemChart({ item, currentMonth }: SeasonalItemChartProps) {
  const chartData = item.monthly.map((m, i) => ({
    month: m.monthName,
    quantity: m.quantity,
    strength: Math.round(item.seasonalStrengths[i]),
    isPeak: m.month === item.peakMonth,
    isCurrent: m.month === currentMonth,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{item.name}</h3>
          <p className="text-xs text-muted-foreground">
            Category: {item.category} · Yearly Total: {item.yearlyTotal} · Avg/Month: {Math.round(item.yearlyAvg)}
          </p>
        </div>
        <Badge variant="outline">Peak: {item.peakMonthName} ({item.peakQuantity} units)</Badge>
      </div>

      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg p-3 shadow-lg">
                    <p className="font-medium">{d.month}</p>
                    <p className="text-sm">Quantity: <span className="font-semibold">{d.quantity}</span></p>
                    <p className="text-sm">Seasonal Strength: <span className="font-semibold">{d.strength}%</span></p>
                    {d.isPeak && <Badge className="mt-1 text-xs">Peak Month</Badge>}
                  </div>
                );
              }}
            />
            {item.yearlyAvg > 0 && (
              <ReferenceLine
                y={Math.round(item.yearlyAvg)}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                label={{ value: 'Avg', position: 'right', className: 'fill-muted-foreground text-xs' }}
              />
            )}
            <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    entry.isPeak
                      ? 'hsl(var(--primary))'
                      : entry.isCurrent
                        ? 'hsl(var(--accent-foreground))'
                        : entry.quantity > 0
                          ? 'hsl(var(--muted-foreground) / 0.5)'
                          : 'hsl(var(--muted) / 0.3)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insight */}
      {item.insight && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <p className="text-sm">💡 {item.insight}</p>
        </div>
      )}
    </div>
  );
}
