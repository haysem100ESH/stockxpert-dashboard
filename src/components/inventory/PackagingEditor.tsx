/**
 * PackagingEditor
 * ----------------------------------------------------------------------------
 * Reusable 3-step packaging editor: Unit (always) → Strip (toggle) → Pack
 * (toggle, gated on Strip). Shows live summary and price auto-fill.
 *
 * Caller owns the Packaging state via `value` + `onChange`.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Packaging,
  packagingSummary,
  autoStripPrice,
  autoPackPrice,
} from '@/lib/packaging';

interface Props {
  value: Packaging;
  onChange: (next: Packaging) => void;
  /** Hide pricing inputs (used when prices live elsewhere on the form). */
  hidePrices?: boolean;
}

export default function PackagingEditor({ value, onChange, hidePrices }: Props) {
  const set = (patch: Partial<Packaging>) => onChange({ ...value, ...patch });

  const stripAuto = autoStripPrice(value);
  const packAuto = autoPackPrice(value);

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div>
        <Label className="text-sm font-semibold">Packaging</Label>
        <p className="text-xs text-muted-foreground">{packagingSummary(value)}</p>
      </div>

      {/* Level 1: Unit (always) */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Unit (smallest sellable level) *
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="unit_name">Unit name</Label>
            <Input
              id="unit_name"
              value={value.unit_name}
              onChange={(e) => set({ unit_name: e.target.value })}
              placeholder="tablet, capsule, ml…"
              required
            />
          </div>
          {!hidePrices && (
            <div className="space-y-1">
              <Label htmlFor="unit_price">Unit price</Label>
              <Input
                id="unit_price"
                type="number"
                step="0.01"
                min="0"
                value={value.unit_selling_price ?? ''}
                onChange={(e) =>
                  set({ unit_selling_price: e.target.value === '' ? null : parseFloat(e.target.value) })
                }
                placeholder="0.00"
              />
            </div>
          )}
        </div>
      </div>

      {/* Level 2: Strip */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Has strip / blister</Label>
          <Switch
            checked={value.strip_enabled}
            onCheckedChange={(checked) =>
              set({
                strip_enabled: checked,
                ...(checked ? {} : { pack_enabled: false, strips_per_pack: null, units_per_strip: null }),
              })
            }
          />
        </div>
        {value.strip_enabled && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <Label>Strip name</Label>
              <Input
                value={value.strip_name ?? ''}
                onChange={(e) => set({ strip_name: e.target.value || null })}
                placeholder="strip"
              />
            </div>
            <div className="space-y-1">
              <Label>Units per strip *</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={value.units_per_strip ?? ''}
                onChange={(e) =>
                  set({ units_per_strip: e.target.value === '' ? null : parseInt(e.target.value) })
                }
                placeholder="e.g. 10"
                required
              />
            </div>
            {!hidePrices && (
              <div className="space-y-1 col-span-2">
                <Label>Strip price</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={value.strip_selling_price ?? ''}
                  onChange={(e) =>
                    set({ strip_selling_price: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                  placeholder={stripAuto ? `auto: ${stripAuto.toFixed(2)}` : '0.00'}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Level 3: Pack */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label className={`text-sm ${!value.strip_enabled ? 'text-muted-foreground' : ''}`}>
            Has pack / box
          </Label>
          <Switch
            disabled={!value.strip_enabled}
            checked={value.pack_enabled}
            onCheckedChange={(checked) => set({ pack_enabled: checked })}
          />
        </div>
        {!value.strip_enabled && (
          <p className="text-xs text-muted-foreground">Enable strip first to add a pack level.</p>
        )}
        {value.pack_enabled && value.strip_enabled && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <Label>Pack name</Label>
              <Input
                value={value.pack_name ?? ''}
                onChange={(e) => set({ pack_name: e.target.value || null })}
                placeholder="pack, box…"
              />
            </div>
            <div className="space-y-1">
              <Label>Strips per pack *</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={value.strips_per_pack ?? ''}
                onChange={(e) =>
                  set({ strips_per_pack: e.target.value === '' ? null : parseInt(e.target.value) })
                }
                placeholder="e.g. 10"
                required
              />
            </div>
            {!hidePrices && (
              <div className="space-y-1 col-span-2">
                <Label>Pack price</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={value.pack_selling_price ?? ''}
                  onChange={(e) =>
                    set({ pack_selling_price: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                  placeholder={packAuto ? `auto: ${packAuto.toFixed(2)}` : '0.00'}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
