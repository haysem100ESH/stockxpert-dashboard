/**
 * StockEntryFields
 * ----------------------------------------------------------------------------
 * Multi-field stock entry that adapts to the configured Packaging hierarchy.
 *  - unit only          -> 1 field (units)
 *  - unit + strip       -> 2 fields (strips, remaining units)
 *  - unit + strip + pack-> 3 fields (packs, remaining strips, remaining units)
 *
 * Always reports the total smallest-units to the caller via onTotalChange.
 */
import { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Packaging } from '@/lib/packaging';

const pluralize = (label: string, n: number) => {
  const safe = (label || '').trim() || 'unit';
  if (n === 1) return safe;
  if (/(s|x|z|ch|sh)$/i.test(safe)) return `${safe}es`;
  return `${safe}s`;
};

export interface StockEntry {
  packs: string;
  strips: string;
  units: string;
}

export const emptyStockEntry = (): StockEntry => ({ packs: '', strips: '', units: '' });

/** Convert a total-unit count into pack/strip/unit fields based on packaging. */
export function unitsToEntry(total: number, p: Packaging): StockEntry {
  const t = Math.max(0, Math.floor(total || 0));
  if (p.pack_enabled && p.strip_enabled && p.strips_per_pack && p.units_per_strip) {
    const upp = p.strips_per_pack * p.units_per_strip;
    const packs = Math.floor(t / upp);
    const rem = t - packs * upp;
    const strips = Math.floor(rem / p.units_per_strip);
    const units = rem - strips * p.units_per_strip;
    return { packs: String(packs), strips: String(strips), units: String(units) };
  }
  if (p.strip_enabled && p.units_per_strip) {
    const strips = Math.floor(t / p.units_per_strip);
    const units = t - strips * p.units_per_strip;
    return { packs: '', strips: String(strips), units: String(units) };
  }
  return { packs: '', strips: '', units: String(t) };
}

/** Compute total units from a StockEntry given a Packaging. */
export function entryToUnits(e: StockEntry, p: Packaging): number {
  const packs = parseInt(e.packs || '0') || 0;
  const strips = parseInt(e.strips || '0') || 0;
  const units = parseInt(e.units || '0') || 0;
  if (p.pack_enabled && p.strip_enabled && p.strips_per_pack && p.units_per_strip) {
    return packs * p.strips_per_pack * p.units_per_strip + strips * p.units_per_strip + units;
  }
  if (p.strip_enabled && p.units_per_strip) {
    return strips * p.units_per_strip + units;
  }
  return units;
}

interface Props {
  packaging: Packaging;
  value: StockEntry;
  onChange: (next: StockEntry) => void;
  onTotalChange?: (total: number) => void;
  disabled?: boolean;
  helperPrefix?: string;
}

export default function StockEntryFields({
  packaging,
  value,
  onChange,
  onTotalChange,
  disabled,
  helperPrefix = 'Total',
}: Props) {
  const total = entryToUnits(value, packaging);
  useEffect(() => { onTotalChange?.(total); }, [total]); // eslint-disable-line

  const unit = packaging.unit_name || 'unit';
  const strip = packaging.strip_name || 'strip';
  const pack = packaging.pack_name || 'pack';

  const set = (patch: Partial<StockEntry>) => onChange({ ...value, ...patch });
  const sanitize = (v: string) => v.replace(/[^0-9]/g, '');

  const showStrip = packaging.strip_enabled && !!packaging.units_per_strip;
  const showPack = packaging.pack_enabled && showStrip && !!packaging.strips_per_pack;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
      <Label className="text-sm font-semibold">Stock on hand</Label>
      <div className={`grid gap-3 ${showPack ? 'grid-cols-3' : showStrip ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {showPack && (
          <div className="space-y-1">
            <Label className="text-xs">{pluralize(pack, 2)}</Label>
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={value.packs}
              onChange={(e) => set({ packs: sanitize(e.target.value) })}
              disabled={disabled}
              placeholder="0"
            />
          </div>
        )}
        {showStrip && (
          <div className="space-y-1">
            <Label className="text-xs">
              {showPack ? `Remaining ${pluralize(strip, 2)}` : pluralize(strip, 2)}
            </Label>
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={value.strips}
              onChange={(e) => set({ strips: sanitize(e.target.value) })}
              disabled={disabled}
              placeholder="0"
            />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">
            {showStrip ? `Remaining ${pluralize(unit, 2)}` : pluralize(unit, 2)}
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={value.units}
            onChange={(e) => set({ units: sanitize(e.target.value) })}
            disabled={disabled}
            placeholder="0"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {helperPrefix}: {total} {pluralize(unit, total)}
      </p>
    </div>
  );
}
