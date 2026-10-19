import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SmartItem } from '@/hooks/useSmartInventory';
import { useSupplierIntelligence } from '@/hooks/useSupplierIntelligence';
import { ShoppingCart, Truck, AlertTriangle } from 'lucide-react';
import { TrendIndicator } from './TrendIndicator';

interface ReorderSuggestionsProps {
  items: SmartItem[];
  isPharmacy: boolean;
}

export default function ReorderSuggestions({ items, isPharmacy }: ReorderSuggestionsProps) {
  const { getBestSupplierForItem } = useSupplierIntelligence();
  const sorted = [...items].sort((a, b) => b.suggestedReorder - a.suggestedReorder);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-amber-500" />
          Smart Reorder Suggestions
        </CardTitle>
        <CardDescription>
          {isPharmacy ? 'Medicines' : 'Items'} where effective stock has reached the reorder point (ROP = ADC × lead-time + safety stock). Near-expiry batches are excluded from available stock.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            All {isPharmacy ? 'medicines' : 'items'} are above their reorder points.
          </p>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trend</TableHead>
                    <TableHead className="text-right">Effective Stock</TableHead>
                    <TableHead className="text-right">Lead Time</TableHead>
                    <TableHead className="text-right">Reorder Point</TableHead>
                    <TableHead className="text-right">Forecast Demand</TableHead>
                    <TableHead className="text-right">Safety</TableHead>
                    <TableHead className="text-right">
                      <span className="text-amber-600 font-semibold">Suggested</span>
                    </TableHead>
                    <TableHead>Urgency</TableHead>
                    <TableHead>Best Supplier</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((item) => {
                    const urgency = item.daysRemaining !== null && item.daysRemaining < 3
                      ? 'critical'
                      : item.daysRemaining !== null && item.daysRemaining < 7
                      ? 'high'
                      : 'medium';

                    const bestSupplier = getBestSupplierForItem(item.id);
                    const estCost = bestSupplier ? bestSupplier.price * item.suggestedReorder : null;

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell><TrendIndicator item={item} /></TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1 justify-end">
                            <span>{item.effectiveStock}</span>
                            {item.hasExpiryExclusion && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {item.expiringSoonQty} unit{item.expiringSoonQty === 1 ? '' : 's'} excluded —
                                  expiring within the {item.leadTimeDays}-day lead-time window.
                                  Total stock: {item.currentStock}.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.leadTimeDays}d</TableCell>
                        <TableCell className="text-right">{Math.ceil(item.reorderPoint)}</TableCell>
                        <TableCell className="text-right">
                          {Math.ceil(item.forecastDemand)}
                          <span className="text-[10px] text-muted-foreground ml-1">/{item.forecastDays}d</span>
                        </TableCell>
                        <TableCell className="text-right">{Math.ceil(item.safetyStock)}</TableCell>
                        <TableCell className="text-right font-bold text-amber-600">
                          +{item.suggestedReorder}
                        </TableCell>
                        <TableCell>
                          <Badge variant={urgency === 'critical' ? 'destructive' : urgency === 'high' ? 'secondary' : 'outline'}>
                            {urgency}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {bestSupplier ? (
                            <div className="flex items-center gap-1">
                              <Truck className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm">{bestSupplier.supplierName}</span>
                              <Badge variant="outline" className="text-xs ml-1">{bestSupplier.score}</Badge>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">No pricing data</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {estCost !== null ? (
                            <span className="font-medium">{estCost.toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
