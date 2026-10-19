import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { SmartItem } from '@/hooks/useSmartInventory';

interface StockOutAlertsProps {
  items: SmartItem[];
  isPharmacy: boolean;
}

export default function StockOutAlerts({ items, isPharmacy }: StockOutAlertsProps) {
  const sorted = [...items].sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Stock-Out Prediction
        </CardTitle>
        <CardDescription>
          {isPharmacy ? 'Medicines' : 'Items'} predicted to run out within 7 days based on sales velocity
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No stock-out risks detected. All items have sufficient stock.
          </p>
        ) : (
          <div className="grid gap-3">
            {sorted.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg bg-destructive/5">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.category}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      ADC: {item.adc.toFixed(2)} | Stock: {item.currentStock}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="destructive" className="text-lg px-3 py-1">
                    {item.daysRemaining !== null ? `${item.daysRemaining}d left` : '—'}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    Reorder: +{item.suggestedReorder}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
