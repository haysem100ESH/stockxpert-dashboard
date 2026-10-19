import { SupplierScore } from '@/hooks/useSupplierIntelligence';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface SupplierScoreCardProps {
  supplier: SupplierScore;
}

const scoreLevelConfig = {
  excellent: { label: 'Excellent', variant: 'default' as const, color: 'text-green-500' },
  good: { label: 'Good', variant: 'secondary' as const, color: 'text-blue-500' },
  average: { label: 'Average', variant: 'outline' as const, color: 'text-amber-500' },
  risky: { label: 'Risky', variant: 'destructive' as const, color: 'text-destructive' },
};

export default function SupplierScoreCard({ supplier }: SupplierScoreCardProps) {
  const config = scoreLevelConfig[supplier.scoreLevel];

  const metrics = [
    { label: 'Price', score: supplier.priceScore, weight: '30%' },
    { label: 'Delivery', score: supplier.deliveryScore, weight: '25%' },
    { label: 'Accuracy', score: supplier.accuracyScore, weight: '25%' },
    { label: 'Availability', score: supplier.availabilityScore, weight: '20%' },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">{supplier.name}</h3>
            {supplier.contactPerson && (
              <p className="text-xs text-muted-foreground">{supplier.contactPerson}</p>
            )}
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${config.color}`}>{supplier.overallScore}</p>
            <Badge variant={config.variant} className="text-xs">{config.label}</Badge>
          </div>
        </div>

        <div className="space-y-2">
          {metrics.map(m => (
            <div key={m.label} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20">{m.label} ({m.weight})</span>
              <Progress value={m.score} className="flex-1 h-2" />
              <span className="text-xs font-medium w-8 text-right">{m.score}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
          <div className="text-center">
            <p className="text-sm font-semibold">{supplier.totalPurchases}</p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold">{supplier.totalSpent.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total Spent</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold">{supplier.purchaseShare}%</p>
            <p className="text-xs text-muted-foreground">Share</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
