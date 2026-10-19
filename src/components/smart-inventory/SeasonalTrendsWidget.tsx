import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { SeasonalItem } from '@/hooks/useSeasonalPerformance';
import { TrendingUp, Sun } from 'lucide-react';

interface SeasonalTrendsWidgetProps {
  topItems: SeasonalItem[];
  currentMonthName: string;
  isPharmacy: boolean;
}

export default function SeasonalTrendsWidget({ topItems, currentMonthName, isPharmacy }: SeasonalTrendsWidgetProps) {
  const label = isPharmacy ? 'products' : 'items';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sun className="h-5 w-5 text-primary" />
          Seasonal Trends — {currentMonthName}
        </CardTitle>
        <CardDescription>
          Top {label} with strong demand this month
        </CardDescription>
      </CardHeader>
      <CardContent>
        {topItems.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            No seasonal peaks detected for {currentMonthName}.
          </p>
        ) : (
          <div className="space-y-3">
            {topItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress
                      value={Math.min(100, item.currentMonthStrength)}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs font-medium text-muted-foreground w-12 text-right">
                      {Math.round(item.currentMonthStrength)}%
                    </span>
                  </div>
                </div>
                <TrendingUp className="h-4 w-4 text-green-500 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
