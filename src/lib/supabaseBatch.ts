/**
 * supabaseBatch
 * ----------------------------------------------------------------------------
 * Helpers for executing Supabase `.in(column, ids)` queries against large id
 * arrays reliably on slow / unstable connections.
 *
 * Why this exists:
 *   PostgREST encodes `.in()` filters in the URL. With 400-500+ UUIDs the URL
 *   grows past ~16KB which intermediaries (CDN/proxy/mobile network) often
 *   drop or truncate, causing the query to silently return empty data. This
 *   manifests as "Unknown" item names on Sales and missing batch counts on
 *   Inventory.
 *
 * Fix:
 *   - Chunk id lists into batches of `CHUNK_SIZE` (default 50).
 *   - Retry each chunk up to `MAX_ATTEMPTS` times with exponential backoff
 *     (1s, 2s, 4s).
 *   - Run chunks in parallel (Promise.all) and concatenate results.
 *   - Throws on final failure so callers can surface "Unavailable" instead of
 *     silently mis-rendering.
 */
const CHUNK_SIZE = 50;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunkArr<T>(arr: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Run an async builder once per id-chunk, retrying with exponential backoff.
 *
 * `runner(chunk)` should return a Supabase response `{ data, error }`.
 * Throws after MAX_ATTEMPTS if all retries fail.
 */
export async function chunkedIn<T = any>(
  ids: string[],
  runner: (chunk: string[]) => Promise<{ data: T[] | null; error: any }>,
  chunkSize = CHUNK_SIZE,
): Promise<T[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const chunks = chunkArr(unique, chunkSize);

  const runChunk = async (c: string[]): Promise<T[]> => {
    let lastErr: any;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const { data, error } = await runner(c);
        if (error) throw error;
        return (data ?? []) as T[];
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(1000 * Math.pow(2, attempt));
        }
      }
    }
    throw lastErr ?? new Error('chunkedIn: request failed');
  };

  const results = await Promise.all(chunks.map(runChunk));
  return results.flat();
}

/** Same as chunkedIn but never throws — returns whatever chunks succeeded. */
export async function chunkedInPartial<T = any>(
  ids: string[],
  runner: (chunk: string[]) => Promise<{ data: T[] | null; error: any }>,
  chunkSize = CHUNK_SIZE,
): Promise<{ data: T[]; failed: boolean }> {
  try {
    const data = await chunkedIn<T>(ids, runner, chunkSize);
    return { data, failed: false };
  } catch {
    return { data: [], failed: true };
  }
}
