/**
 * packaging.ts
 * ----------------------------------------------------------------------------
 * Shared utilities for the unit/strip/pack packaging model.
 *
 * Stock is ALWAYS stored as total smallest-units. These helpers convert
 * between user-entered quantities at any level and total units, and format
 * total-unit numbers back into a human-readable breakdown.
 */

export type PackagingLevel = 'unit' | 'strip' | 'pack';

export interface Packaging {
  unit_name: string;
  strip_enabled: boolean;
  units_per_strip?: number | null;
  strip_name?: string | null;
  pack_enabled: boolean;
  strips_per_pack?: number | null;
  pack_name?: string | null;
  unit_selling_price?: number | null;
  strip_selling_price?: number | null;
  pack_selling_price?: number | null;
}

const pluralize = (label: string, n: number) => {
  const safe = (label || '').trim() || 'unit';
  if (n === 1) return safe;
  if (/(s|x|z|ch|sh)$/i.test(safe)) return `${safe}es`;
  return `${safe}s`;
};

/** Convert a quantity entered at a given level into total smallest units. */
export function convertToUnits(
  qty: number,
  level: PackagingLevel,
  p: Packaging,
): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  switch (level) {
    case 'unit':
      return qty;
    case 'strip':
      if (!p.strip_enabled || !p.units_per_strip) return qty; // fallback
      return qty * p.units_per_strip;
    case 'pack':
      if (
        !p.pack_enabled ||
        !p.strip_enabled ||
        !p.strips_per_pack ||
        !p.units_per_strip
      ) return qty;
      return qty * p.strips_per_pack * p.units_per_strip;
  }
}

/** Total units contained in 1 strip (or 1 if strip disabled). */
export const unitsPerStripSafe = (p: Packaging) =>
  p.strip_enabled && p.units_per_strip ? p.units_per_strip : 1;

/** Total units contained in 1 pack (or 1 if pack disabled). */
export const unitsPerPackSafe = (p: Packaging) =>
  p.pack_enabled && p.strip_enabled && p.strips_per_pack && p.units_per_strip
    ? p.strips_per_pack * p.units_per_strip
    : unitsPerStripSafe(p);

/**
 * Format a total-units quantity into a human-readable breakdown.
 *  - pack enabled  -> "3 packs, 2 strips, 5 tablets"
 *  - strip enabled -> "14 strips, 3 tablets"
 *  - neither       -> "47 tablets"
 */
export function formatStock(totalUnits: number, p: Packaging): string {
  const total = Math.max(0, Math.floor(totalUnits || 0));
  const unit = p.unit_name || 'unit';
  const strip = p.strip_name || 'strip';
  const pack = p.pack_name || 'pack';

  if (p.pack_enabled && p.strip_enabled && p.strips_per_pack && p.units_per_strip) {
    const upp = p.strips_per_pack * p.units_per_strip;
    const packs = Math.floor(total / upp);
    const remAfterPacks = total - packs * upp;
    const strips = Math.floor(remAfterPacks / p.units_per_strip);
    const units = remAfterPacks - strips * p.units_per_strip;
    const parts: string[] = [];
    if (packs) parts.push(`${packs} ${pluralize(pack, packs)}`);
    if (strips) parts.push(`${strips} ${pluralize(strip, strips)}`);
    if (units || parts.length === 0) parts.push(`${units} ${pluralize(unit, units)}`);
    let result = parts.join(', ');
    // Always show the total strip equivalence when stock contains whole packs,
    // so users can see how many strips the packs represent (e.g. "37 packs, 4 strips (300 strips total)").
    if (packs > 0 && p.strips_per_pack) {
      const totalStrips = packs * p.strips_per_pack + strips;
      if (totalStrips !== strips) {
        result += ` (${totalStrips} ${pluralize(strip, totalStrips)} total)`;
      }
    }
    return result;
  }
  if (p.strip_enabled && p.units_per_strip) {
    const strips = Math.floor(total / p.units_per_strip);
    const units = total - strips * p.units_per_strip;
    const parts: string[] = [];
    if (strips) parts.push(`${strips} ${pluralize(strip, strips)}`);
    if (units || parts.length === 0) parts.push(`${units} ${pluralize(unit, units)}`);
    return parts.join(', ');
  }
  return `${total} ${pluralize(unit, total)}`;
}

/** "1 pack = 10 strips = 100 tablets" */
export function packagingSummary(p: Packaging): string {
  const unit = p.unit_name || 'unit';
  if (p.pack_enabled && p.strip_enabled && p.strips_per_pack && p.units_per_strip) {
    const total = p.strips_per_pack * p.units_per_strip;
    return `1 ${p.pack_name || 'pack'} = ${p.strips_per_pack} ${pluralize(
      p.strip_name || 'strip',
      p.strips_per_pack,
    )} = ${total} ${pluralize(unit, total)}`;
  }
  if (p.strip_enabled && p.units_per_strip) {
    return `1 ${p.strip_name || 'strip'} = ${p.units_per_strip} ${pluralize(
      unit,
      p.units_per_strip,
    )}`;
  }
  return `Sold by ${unit}`;
}

/** Available levels for selling/quantity inputs. */
export function availableLevels(p: Packaging): PackagingLevel[] {
  const out: PackagingLevel[] = ['unit'];
  if (p.strip_enabled) out.push('strip');
  if (p.pack_enabled) out.push('pack');
  return out;
}

/** Auto-calc helpers for prices (caller may override the result). */
export const autoStripPrice = (p: Packaging) =>
  p.strip_enabled && p.units_per_strip && p.unit_selling_price
    ? p.units_per_strip * p.unit_selling_price
    : null;

export const autoPackPrice = (p: Packaging) =>
  p.pack_enabled && p.strips_per_pack && (p.strip_selling_price ?? autoStripPrice(p))
    ? p.strips_per_pack * (p.strip_selling_price ?? autoStripPrice(p)!)
    : null;

/** Default packaging row for a brand-new medicine. */
export const defaultPackaging = (): Packaging => ({
  unit_name: 'tablet',
  strip_enabled: false,
  units_per_strip: null,
  strip_name: null,
  pack_enabled: false,
  strips_per_pack: null,
  pack_name: null,
  unit_selling_price: null,
  strip_selling_price: null,
  pack_selling_price: null,
});
