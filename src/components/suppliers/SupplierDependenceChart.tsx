import { SupplierScore } from '@/hooks/useSupplierIntelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, AlertTriangle } from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend
} from 'recharts';

const COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

interface SupplierDependenceChartProps {
  suppliers: SupplierScore[];
}

export default function SupplierDependenceChart({ suppliers }: SupplierDependenceChartProps) {
  const chartData = suppliers
    .filter(s => s.totalSpent > 0)
    .map(s => ({
      name: s.name,
      value: s.totalSpent,
      share: s.purchaseShare,
      isRisk: s.purchaseShare > 40,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Supplier Dependence Analysis
        </CardTitle>
        <CardDescription>
          Distribution of purchase spending across suppliers. High concentration (&gt;40%) indicates risk.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No purchase data to analyze dependence.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, share }) => `${name} (${share}%)`}
                    labelLine={false}
                  >
                    {chartData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg p-3 shadow-lg">
                          <p className="font-medium">{d.name}</p>
                          <p className="text-sm">Spent: {d.value.toLocaleString()}</p>
                          <p className="text-sm">Share: {d.share}%</p>
                          {d.isRisk && (
                            <Badge variant="destructive" className="mt-1 text-xs">High Dependence</Badge>
                          )}
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-sm">Supplier Share Breakdown</h4>
              {suppliers.filter(s => s.totalSpent > 0).map(s => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-sm w-28 truncate">{s.name}</span>
                  <div className="flex-1">
                    <Progress
                      value={s.purchaseShare}
                      className={`h-3 ${s.purchaseShare > 40 ? '[&>div]:bg-destructive' : ''}`}
                    />
                  </div>
                  <span className={`text-xs font-medium w-10 text-right ${s.purchaseShare > 40 ? 'text-destructive' : ''}`}>
                    {s.purchaseShare}%
                  </span>
                  {s.purchaseShare > 40 && (
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
