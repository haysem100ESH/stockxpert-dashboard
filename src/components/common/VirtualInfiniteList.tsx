/**
 * VirtualInfiniteList
 * ----------------------------------------------------------------------------
 * Drop-in virtualized list backed by useInfiniteCursor (keyset pagination).
 * Renders only the rows currently visible in the viewport — handles 5M+ rows
 * with constant memory.
 *
 * Usage:
 *   <VirtualInfiniteList
 *     queryKey={['sales-feed', branchId]}
 *     table="sales"
 *     select="id,total_amount,created_at,payment_method"
 *     filters={{ branch_id: branchId }}
 *     estimateRowHeight={56}
 *     renderRow={(row) => <SaleRow sale={row} />}
 *   />
 */
import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInfiniteCursor, type UseInfiniteCursorArgs } from '@/hooks/useInfiniteCursor';
import { Loader2 } from 'lucide-react';

export interface VirtualInfiniteListProps<T> extends UseInfiniteCursorArgs {
  /** Render a single row. Keep it cheap — runs on every scroll tick. */
  renderRow: (row: T, index: number) => React.ReactNode;
  /** Pixel height estimate. Variable rows OK — virtualizer measures actual. */
  estimateRowHeight?: number;
  /** Container max height (CSS). Default 70vh. */
  height?: string | number;
  /** Empty-state UI. */
  empty?: React.ReactNode;
  /** Overscan rows above/below viewport. Default 8. */
  overscan?: number;
  className?: string;
}

export function VirtualInfiniteList<T = any>(props: VirtualInfiniteListProps<T>) {
  const {
    renderRow,
    estimateRowHeight = 56,
    height = '70vh',
    empty,
    overscan = 8,
    className,
    ...cursorArgs
  } = props;

  const parentRef = useRef<HTMLDivElement>(null);

  const {
    rows,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteCursor<T>(cursorArgs);

  const virtualizer = useVirtualizer({
    count: hasNextPage ? rows.length + 1 : rows.length, // +1 sentinel
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  // Auto-load next page when sentinel scrolls into view.
  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    const last = items[items.length - 1];
    if (!last) return;
    if (last.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualizer.getVirtualItems(), rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-destructive text-sm">
        Failed to load: {error.message}
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{empty ?? <div className="py-12 text-center text-muted-foreground">No results</div>}</>;
  }

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ height, overflow: 'auto', contain: 'strict' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const isSentinel = vi.index >= rows.length;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {isSentinel ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
                  {isFetchingNextPage ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading more…</>
                  ) : 'Scroll for more'}
                </div>
              ) : (
                renderRow(rows[vi.index], vi.index)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
