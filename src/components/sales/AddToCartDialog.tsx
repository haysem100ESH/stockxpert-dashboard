import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePackaging } from '@/hooks/usePackaging';
import {
  PackagingLevel,
  availableLevels,
  unitsPerStripSafe,
  unitsPerPackSafe,
  autoStripPrice,
  autoPackPrice,
  formatStock,
} from '@/lib/packaging';

interface Medicine {
  id: string;
  medicine_id?: string;
  name: string;
  generic_name?: string;
  selling_price: number;
  stock_quantity: number;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  item_type?: string;
}

export interface AddToCartMeta {
  sellLevel?: PackagingLevel;
  unitsPerLevel?: number;
  levelPrice?: number;
  levelLabel?: string;
}

interface AddToCartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAddToCart: (
    medicine: Medicine,
    saleType: 'full_pack' | 'by_stripe',
    stripesCount: number,
    meta?: AddToCartMeta,
  ) => void;
}

export default function AddToCartDialog({ open, onOpenChange, medicine, onAddToCart }: AddToCartDialogProps) {
  const { packaging } = usePackaging(medicine?.medicine_id);

  const isMeasurableItem = medicine?.item_type === 'measurable';

  // Available levels from packaging (defaults to ['unit'] when missing)
  const levels: PackagingLevel[] = useMemo(
    () => (packaging ? availableLevels(packaging) : ['unit']),
    [packaging],
  );

  const [mode, setMode] = useState<'piece' | 'group'>('piece');
  const [level, setLevel] = useState<PackagingLevel>('unit');
  const [count, setCount] = useState<string>('1');
  const [measurableWhole, setMeasurableWhole] = useState<string>('1');
  const [measurableDecimal, setMeasurableDecimal] = useState<string>('0');

  // Default to selling per unit (piece). User can pick strip/pack if enabled.
  useEffect(() => {
    if (!open) return;
    setMode('piece');
    setLevel('unit');
    setCount('1');
    setMeasurableWhole('1');
    setMeasurableDecimal('0');
  }, [open, levels]);

  const hasStrip = !!packaging?.strip_enabled;
  const hasPack = !!packaging?.pack_enabled;
  const hasGroup = hasStrip || hasPack;

  if (!medicine) return null;

  const totalUnits = medicine.stock_quantity || 0;
  const upStrip = packaging ? unitsPerStripSafe(packaging) : 1;
  const upPack = packaging ? unitsPerPackSafe(packaging) : 1;

  const unitName = packaging?.unit_name || medicine.unit_label || 'unit';
  const stripName = packaging?.strip_name || 'strip';
  const packName = packaging?.pack_name || 'pack';

  const levelLabel = level === 'unit' ? unitName : level === 'strip' ? stripName : packName;
  const unitsPerLevel = level === 'unit' ? 1 : level === 'strip' ? upStrip : upPack;

  // Pricing per level — when LPI (unit_selling_price) is set, ALWAYS derive
  // strip/pack from it (strip = upStrip × unit, pack = upPack × unit) so a
  // stale stored strip_selling_price/pack_selling_price can never override.
  const unitPrice = packaging?.unit_selling_price ?? (medicine.selling_price && upPack ? medicine.selling_price / upPack : medicine.selling_price);
  const stripPrice = packaging?.unit_selling_price != null
    ? unitPrice * upStrip
    : (packaging?.strip_selling_price ?? (autoStripPrice(packaging || ({} as any)) ?? unitPrice * upStrip));
  const packPrice = packaging?.unit_selling_price != null
    ? unitPrice * upPack
    : (packaging?.pack_selling_price ?? (autoPackPrice(packaging || ({} as any)) ?? medicine.selling_price ?? unitPrice * upPack));
  const levelPrice = level === 'unit' ? unitPrice : level === 'strip' ? stripPrice : packPrice;

  const maxAtLevel = Math.floor(totalUnits / unitsPerLevel);

  const getMeasurableQuantity = () => {
    const whole = parseInt(measurableWhole) || 0;
    const padded = (measurableDecimal || '0').padEnd(2, '0').slice(0, 2);
    const dec = parseInt(padded) / 100;
    return parseFloat((whole + dec).toFixed(2));
  };

  const buildClone = (qty: number): Medicine => ({
    ...medicine,
    units_per_pack: unitsPerLevel,
    selling_price: levelPrice,
    unit_label: levelLabel,
    open_pack_units: 0,
    stock_quantity: maxAtLevel, // expressed in chosen-level count
  });

  const handleAdd = () => {
    if (isMeasurableItem) {
      const qty = getMeasurableQuantity();
      if (qty <= 0) {
        toast.error('Enter a quantity greater than zero');
        return;
      }
      if (qty > totalUnits) {
        toast.error(`Not enough stock — only ${totalUnits} ${unitName} available`);
        return;
      }
      onAddToCart(medicine, 'full_pack', qty);
    } else {
      const n = parseInt(count);
      if (!n || n <= 0) {
        toast.error(`Enter at least 1 ${levelLabel}`);
        return;
      }
      if (n > maxAtLevel) {
        toast.error(
          maxAtLevel < 1
            ? `Out of stock — cannot sell by ${levelLabel}`
            : `Not enough stock — only ${maxAtLevel} ${levelLabel}${maxAtLevel === 1 ? '' : 's'} available`,
        );
        return;
      }
      onAddToCart(medicine, 'full_pack', n, {
        sellLevel: level,
        unitsPerLevel,
        levelPrice,
        levelLabel,
      });
    }
    onOpenChange(false);
  };

  const totalDisplay = (() => {
    const n = parseInt(count) || 0;
    return (n * levelPrice).toFixed(2);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Add to Cart</DialogTitle>
          <DialogDescription>
            {medicine.name}
            {medicine.generic_name && ` (${medicine.generic_name})`}
            {isMeasurableItem && <Badge variant="secondary" className="ml-2">Measurable</Badge>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stock summary */}
          <div className="space-y-1 bg-muted/40 rounded-lg p-3 text-sm">
            <div className="flex justify-between">
              <span>Available stock:</span>
              <span className="font-medium">
                {isMeasurableItem
                  ? `${totalUnits} ${unitName}`
                  : packaging
                    ? formatStock(totalUnits, packaging)
                    : `${totalUnits} ${unitName}`}
              </span>
            </div>
            {!isMeasurableItem && (
              <>
                <div className="flex justify-between">
                  <span>Unit price ({unitName}):</span>
                  <span>ETB {Number(unitPrice || 0).toFixed(2)}</span>
                </div>
                {packaging?.strip_enabled && (
                  <div className="flex justify-between">
                    <span>Strip price ({stripName}):</span>
                    <span>ETB {Number(stripPrice || 0).toFixed(2)}</span>
                  </div>
                )}
                {packaging?.pack_enabled && (
                  <div className="flex justify-between">
                    <span>Pack price ({packName}):</span>
                    <span>ETB {Number(packPrice || 0).toFixed(2)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Measurable input */}
          {isMeasurableItem && (
            <div className="space-y-2">
              <Label>Quantity ({unitName})</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={measurableWhole}
                  onChange={(e) => setMeasurableWhole(e.target.value)}
                  className="flex-1"
                />
                <span className="text-lg font-bold">.</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={measurableDecimal}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                    setMeasurableDecimal(val);
                  }}
                  className="w-20 text-center"
                />
                <span className="text-sm text-muted-foreground">{unitName}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Total: ETB {(getMeasurableQuantity() * (medicine.selling_price || 0)).toFixed(2)}
              </p>
            </div>
          )}

          {/* Mode selector: piece vs group */}
          {!isMeasurableItem && (
            <>
              <div className="space-y-2">
                <Label>Sell by</Label>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => {
                    if (!v) return;
                    const m = v as 'piece' | 'group';
                    setMode(m);
                    if (m === 'piece') setLevel('unit');
                    else setLevel(hasStrip ? 'strip' : 'pack');
                    setCount('1');
                  }}
                  className="justify-start"
                >
                  <ToggleGroupItem value="piece" variant="outline">
                    Sell by {unitName}
                  </ToggleGroupItem>
                  {hasGroup && (
                    <ToggleGroupItem value="group" variant="outline">
                      Sell by group
                    </ToggleGroupItem>
                  )}
                </ToggleGroup>
              </div>

              {mode === 'group' && hasGroup && (
                <div className="space-y-2">
                  <Label>Group type</Label>
                  <ToggleGroup
                    type="single"
                    value={level}
                    onValueChange={(v) => v && (setLevel(v as PackagingLevel), setCount('1'))}
                    className="justify-start"
                  >
                    {hasStrip && (
                      <ToggleGroupItem value="strip" variant="outline">
                        {stripName} ({Math.floor(totalUnits / upStrip)} available)
                      </ToggleGroupItem>
                    )}
                    {hasPack && (
                      <ToggleGroupItem value="pack" variant="outline">
                        {packName} ({Math.floor(totalUnits / upPack)} available)
                      </ToggleGroupItem>
                    )}
                  </ToggleGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="count">
                  Number of {levelLabel}{maxAtLevel === 1 ? '' : 's'} (max {maxAtLevel})
                </Label>
                <Input
                  id="count"
                  type="number"
                  min="1"
                  step="1"
                  max={maxAtLevel}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(count);
                    const clamped = isNaN(n) || n <= 0 ? 1 : Math.min(n, Math.max(maxAtLevel, 1));
                    setCount(String(clamped));
                  }}
                />
                <p className="text-sm text-muted-foreground">Total: ETB {totalDisplay}</p>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleAdd} className="flex-1" disabled={!isMeasurableItem && maxAtLevel < 1}>
              Add to Cart
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
