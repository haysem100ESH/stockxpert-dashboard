/**
 * Ethiopia (Africa/Addis_Ababa) timezone helpers.
 *
 * All financial/date filters in the app must anchor to Ethiopian local time
 * so that "today" means the current calendar day in Addis Ababa, regardless
 * of the browser's timezone or UTC. Ethiopia is a fixed UTC+3 (no DST),
 * which keeps math trivial.
 */

const ADDIS_TZ = 'Africa/Addis_Ababa';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADDIS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function partsInAddis(d: Date): { y: number; m: number; d: number } {
  const parts = dayFmt.formatToParts(d);
  const map: Record<string, string> = {};
  parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
  return { y: +map.year, m: +map.month, d: +map.day };
}

/** YYYY-MM-DD string for the given date, in Addis Ababa timezone. */
export function addisDayString(d: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD.
  return dayFmt.format(d);
}

/** YYYY-MM-DD offset by `days` (positive = future) from `ref`, in Addis. */
export function addisDayOffset(days: number, ref: Date = new Date()): string {
  return addisDayString(new Date(ref.getTime() + days * 86_400_000));
}

/**
 * Start-of-period day (inclusive) for the standard finance/dashboard filters,
 * expressed as YYYY-MM-DD in Addis time.
 *
 * - daily   → today
 * - weekly  → 6 days ago (last 7 days incl. today)
 * - monthly → 29 days ago (last 30 days incl. today)
 * - yearly  → 1 year ago (same month/day)
 */
export function addisPeriodStartDay(
  period: 'daily' | 'weekly' | 'monthly' | 'yearly',
  ref: Date = new Date(),
): string {
  if (period === 'daily') return addisDayString(ref);
  if (period === 'weekly') return addisDayOffset(-6, ref);
  if (period === 'monthly') return addisDayOffset(-29, ref);
  const p = partsInAddis(ref);
  return `${p.y - 1}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
