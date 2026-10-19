// Measurable unit labels — items with these unit_labels support decimal quantities
export const MEASURABLE_UNITS = ['kg', 'g', 'gram', 'liter', 'l', 'ml', 'meter', 'm', 'cm'] as const;

export type ItemType = 'full_pcs' | 'measurable';

export function getItemType(unitLabel?: string): ItemType {
  if (!unitLabel) return 'full_pcs';
  return MEASURABLE_UNITS.includes(unitLabel.toLowerCase() as any) ? 'measurable' : 'full_pcs';
}

export function isMeasurable(unitLabel?: string): boolean {
  return getItemType(unitLabel) === 'measurable';
}

/** Measurable unit options for the dropdown */
export const MEASURABLE_UNIT_OPTIONS = [
  { value: 'kg', label: 'Kilogram (Kg)' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'liter', label: 'Liter (L)' },
  { value: 'ml', label: 'Milliliter (mL)' },
  { value: 'meter', label: 'Meter (m)' },
  { value: 'cm', label: 'Centimeter (cm)' },
];
