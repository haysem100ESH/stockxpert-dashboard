/**
 * cursorFetcher
 * ----------------------------------------------------------------------------
 * High-performance, keyset (cursor) pagination over Supabase tables.
 *
 * Why cursor over OFFSET?
 *   OFFSET N forces Postgres to scan & discard N rows. At page 10,000 it is
 *   O(N). Keyset pagination uses an indexed WHERE clause on (created_at, id)
 *   giving O(log N) lookup regardless of page depth.
 *
 * Required index (see sql/cursor-pagination-indexes.sql):
 *   CREATE INDEX ... ON <table> (branch_id, created_at DESC, id DESC);
 *
 * Usage:
 *   const page = await fetchCursorPage({
 *     table: 'sales',
 *     select: 'id,total_amount,created_at',
 *     pageSize: 50,
 *     cursor,                       // null on first page
 *     filters: { branch_id },
 *     orderBy: 'created_at',
 *   });
 */
import { supabase } from '@/lib/db';

export interface Cursor {
  /** ISO timestamp of the last row from the previous page. */
  ts: string;
  /** Tie-breaker id of the last row (UUID/string). */
  id: string;
}

export interface CursorPage<T> {
  rows: T[];
  nextCursor: Cursor | null;
  hasMore: boolean;
}

export interface FetchCursorPageArgs {
  table: string;
  /** Comma-separated column list. Keep LEAN — only fields the UI renders. */
  select: string;
  /** Page size. 50 is a good default; raise for virtualized lists. */
  pageSize?: number;
  /** null on first page. */
  cursor?: Cursor | null;
  /** Equality filters: { branch_id, status, ... }. .in() supported via arrays. */
  filters?: Record<string, string | number | boolean | null | (string | number)[]>;
  /** Cursor column. Must be indexed DESC together with `id`. Default: created_at. */
  orderBy?: string;
  /** Tie-breaker column. Default: id. */
  tieBreaker?: string;
  /** Direction. Default desc (newest-first feeds). */
  ascending?: boolean;
}

export async function fetchCursorPage<T = any>(args: FetchCursorPageArgs): Promise<CursorPage<T>> {
  const {
    table,
    select,
    pageSize = 50,
    cursor = null,
    filters = {},
    orderBy = 'created_at',
    tieBreaker = 'id',
    ascending = false,
  } = args;

  let q: any = supabase.from(table).select(select);

  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  }

  // Keyset predicate: (orderBy, tieBreaker) < (cursor.ts, cursor.id) for DESC,
  // expressed via Supabase's .or() since PostgREST lacks row-tuple comparison.
  if (cursor) {
    if (ascending) {
      q = q.or(
        `${orderBy}.gt.${cursor.ts},and(${orderBy}.eq.${cursor.ts},${tieBreaker}.gt.${cursor.id})`
      );
    } else {
      q = q.or(
        `${orderBy}.lt.${cursor.ts},and(${orderBy}.eq.${cursor.ts},${tieBreaker}.lt.${cursor.id})`
      );
    }
  }

  q = q.order(orderBy, { ascending }).order(tieBreaker, { ascending }).limit(pageSize + 1);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data as T[]) || [];
  const hasMore = rows.length > pageSize;
  const trimmed = hasMore ? rows.slice(0, pageSize) : rows;
  const last = trimmed[trimmed.length - 1] as any;
  const nextCursor: Cursor | null =
    hasMore && last ? { ts: last[orderBy], id: last[tieBreaker] } : null;

  return { rows: trimmed, nextCursor, hasMore };
}

/**
 * Run multiple independent fetchers concurrently. Use for pages that need
 * data from several tables in parallel (e.g. Overview, Smart Inventory).
 */
export async function parallelFetch<T extends Record<string, Promise<any>>>(
  tasks: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(tasks) as (keyof T)[];
  const values = await Promise.all(keys.map((k) => tasks[k]));
  const out = {} as { [K in keyof T]: Awaited<T[K]> };
  keys.forEach((k, i) => (out[k] = values[i]));
  return out;
}
