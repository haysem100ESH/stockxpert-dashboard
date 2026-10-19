import { ItemPriceComparison } from '@/hooks/useSupplierIntelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign } from 'lucide-react';

interface PriceComparisonTableProps {
  comparisons: ItemPriceComparison[];
  isPharmacy: boolean;
}

export default function PriceComparisonTable({ comparisons, isPharmacy }: PriceComparisonTableProps) {
  const label = isPharmacy ? 'Medicine' : 'Item';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          Price Comparison
        </CardTitle>
        <CardDescription>
          Compare {label.toLowerCase()} prices across suppliers. Best prices are highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {comparisons.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No supplier pricing data yet. Add item prices to suppliers to see comparisons.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{label}</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Best Price</TableHead>
                  <TableHead>Best Supplier</TableHead>
                  <TableHead className="text-right">Price Range</TableHead>
                  <TableHead className="text-center">Suppliers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisons.map((c) => (
                  <TableRow key={c.medicineId}>
                    <TableCell className="font-medium">{c.medicineName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{c.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-600">
                      {c.bestPrice.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{c.bestSupplierName}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {c.priceRange > 0 ? (
                        <span className="text-amber-600">±{c.priceRange.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{c.suppliers.length}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
