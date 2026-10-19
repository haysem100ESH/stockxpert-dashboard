/**
 * useInfiniteCursor
 * ----------------------------------------------------------------------------
 * Thin wrapper around TanStack Query's useInfiniteQuery wired to the
 * cursor-pagination fetcher. Drop-in for any table list / virtualized feed.
 *
 * Pair with @tanstack/react-virtual for true virtual scrolling on 5M+ rows.
 *
 * Example:
 *   const { rows, fetchNextPage, hasNextPage, isFetching } = useInfiniteCursor({
 *     queryKey: ['sales', branchId],
 *     table: 'sales',
 *     select: 'id,total_amount,created_at,payment_method',
 *     filters: { branch_id: branchId },
 *     pageSize: 50,
 *   });
 */
import { useMemo } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { fetchCursorPage, type Cursor, type FetchCursorPageArgs } from '@/lib/cursorFetcher';

export interface UseInfiniteCursorArgs extends Omit<FetchCursorPageArgs, 'cursor'> {
  queryKey: QueryKey;
  enabled?: boolean;
  /** ms — defaults to 60s. Raise for cold/static data. */
  staleTime?: number;
  /** ms — defaults to 5 min. */
  gcTime?: number;
}

export function useInfiniteCursor<T = any>(args: UseInfiniteCursorArgs) {
  const {
    queryKey,
    enabled = true,
    staleTime = 60_000,
    gcTime = 5 * 60_000,
    ...fetchArgs
  } = args;

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    staleTime,
    gcTime,
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) =>
      fetchCursorPage<T>({ ...fetchArgs, cursor: pageParam as Cursor | null }),
    getNextPageParam: (last) => last.nextCursor,
  });

  // Flatten pages once. Keep a single allocation per render.
  const rows = useMemo<T[]>(() => {
    const pages = query.data?.pages ?? [];
    const out: T[] = [];
    for (const p of pages) for (const r of p.rows) out.push(r);
    return out;
  }, [query.data]);

  return {
    rows,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    refetch: query.refetch,
    error: query.error as Error | null,
  };
}
