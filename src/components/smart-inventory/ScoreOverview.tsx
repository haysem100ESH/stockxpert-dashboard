import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface ScoreOverviewProps {
  scoreDist: { excellent: number; good: number; risk: number; critical: number };
  avgScore: number;
  totalItems: number;
}

export default function ScoreOverview({ scoreDist, avgScore, totalItems }: ScoreOverviewProps) {
  const segments = [
    { label: 'Excellent (80-100)', count: scoreDist.excellent, color: 'bg-green-500', pct: totalItems ? (scoreDist.excellent / totalItems) * 100 : 0 },
    { label: 'Good (60-79)', count: scoreDist.good, color: 'bg-blue-500', pct: totalItems ? (scoreDist.good / totalItems) * 100 : 0 },
    { label: 'At Risk (40-59)', count: scoreDist.risk, color: 'bg-amber-500', pct: totalItems ? (scoreDist.risk / totalItems) * 100 : 0 },
    { label: 'Critical (<40)', count: scoreDist.critical, color: 'bg-destructive', pct: totalItems ? (scoreDist.critical / totalItems) * 100 : 0 },
  ];

  const scoreColor = avgScore >= 80 ? 'text-green-500' : avgScore >= 60 ? 'text-blue-500' : avgScore >= 40 ? 'text-amber-500' : 'text-destructive';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Inventory Health Score</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6 flex-wrap">
          {/* Big score */}
          <div className="text-center">
            <p className={`text-5xl font-bold ${scoreColor}`}>{avgScore}</p>
            <p className="text-xs text-muted-foreground mt-1">Average Score</p>
          </div>

          {/* Distribution */}
          <div className="flex-1 space-y-2 min-w-[200px]">
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-32 shrink-0">{seg.label}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${seg.color} rounded-full transition-all`} style={{ width: `${seg.pct}%` }} />
                </div>
                <span className="text-xs font-medium w-8 text-right">{seg.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
