/**
 * VirtualList.jsx — PERF-01: Window-scroll virtual list using @tanstack/react-virtual.
 *
 * Uses useWindowVirtualizer so items are virtualized against the page scroll,
 * avoiding nested-scroll UX problems. Falls back to normal rendering for small
 * lists where virtualization has no benefit.
 *
 * Usage:
 *   <VirtualList items={filteredPending} renderItem={(r, i) => <GuardCard key={r.id} req={r} />} estimateSize={148} />
 */
import { useRef, useLayoutEffect } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

/** Minimum list length to activate virtualization (below this, render normally). */
const VIRTUAL_THRESHOLD = 20;

export function VirtualList({ items, renderItem, estimateSize = 130, className = '' }) {
  const listRef = useRef(null);

  const rowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  // Re-measure scroll offset after mount and whenever the list re-mounts.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length <= VIRTUAL_THRESHOLD) {
    // Short list — render normally, no virtualization overhead.
    return (
      <div className={className}>
        {items.map((item, i) => renderItem(item, i))}
      </div>
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div ref={listRef} className={className}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map(vRow => (
          <div
            key={vRow.key}
            data-index={vRow.index}
            ref={rowVirtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vRow.start - (rowVirtualizer.options.scrollMargin ?? 0)}px)`,
            }}
          >
            {renderItem(items[vRow.index], vRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
