/**
 * formatMedicineName
 * --------------------------------------------------------------------------
 * Pharmacy mode appends strength to the medicine name everywhere it is
 * displayed: "Paracetamol" + "500mg" → "Paracetamol 500mg".
 *
 * If strength is empty/null, returns the name unchanged.
 * If the name already ends with the strength (case-insensitive), don't
 * duplicate it.
 */
export function formatMedicineName(
  name: string | null | undefined,
  strength?: string | null
): string {
  const n = (name || '').trim();
  const s = (strength || '').trim();
  if (!s) return n;
  if (n.toLowerCase().endsWith(s.toLowerCase())) return n;
  return `${n} ${s}`;
}

/**
 * Build a packaging label like "3×10" or "10 per pack".
 */
export function formatPackaging(
  stripsPerPack?: number | null,
  unitsPerStrip?: number | null,
  unitsPerPack?: number | null
): string | null {
  if (stripsPerPack && unitsPerStrip) return `${stripsPerPack}×${unitsPerStrip}`;
  if (unitsPerPack) return `${unitsPerPack} per pack`;
  return null;
}
