import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skull } from 'lucide-react';
import { SmartItem } from '@/hooks/useSmartInventory';

interface DeadStockListProps {
  items: SmartItem[];
  isPharmacy: boolean;
}

export default function DeadStockList({ items, isPharmacy }: DeadStockListProps) {
  const sorted = [...items].sort((a, b) => b.currentStock - a.currentStock);

  const totalDeadValue = sorted.reduce((sum, i) => sum + i.currentStock * i.sellingPrice, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Skull className="h-5 w-5 text-orange-500" />
          Dead Stock Detection
        </CardTitle>
        <CardDescription>
          {isPharmacy ? 'Medicines' : 'Items'} with zero sales in the last 60 days but still in stock
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No dead stock detected. All items have recent sales activity.
          </p>
        ) : (
          <>
            <div className="bg-orange-50 dark:bg-orange-950/20 rounded-lg p-3 mb-4 flex items-center justify-between">
              <span className="text-sm font-medium">Total Dead Stock Value</span>
              <span className="text-lg font-bold text-orange-600">ETB {totalDeadValue.toLocaleString()}</span>
            </div>

            <div className="grid gap-3">
              {sorted.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg bg-orange-50/50 dark:bg-orange-950/10">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last sale: {item.lastSaleDate ? new Date(item.lastSaleDate).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-orange-600 border-orange-300">
                      {item.currentStock} in stock
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      Value: ETB {(item.currentStock * item.sellingPrice).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
