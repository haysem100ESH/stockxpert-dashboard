import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SeasonalItem } from '@/hooks/useSeasonalPerformance';
import { Lightbulb } from 'lucide-react';

interface SeasonalInsightsProps {
  insights: SeasonalItem[];
  currentMonthName: string;
}

export default function SeasonalInsights({ insights, currentMonthName }: SeasonalInsightsProps) {
  if (insights.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Seasonal Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            Not enough historical data to generate seasonal insights yet. Insights will appear after more sales history is recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          Seasonal Insights
        </CardTitle>
        <CardDescription>AI-generated actionable suggestions based on seasonal patterns</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border"
          >
            <span className="text-lg mt-0.5">💡</span>
            <div className="flex-1">
              <p className="text-sm">{item.insight}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="outline" className="text-xs">{item.category}</Badge>
                <Badge variant="secondary" className="text-xs">
                  Peak: {item.peakMonthName}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
