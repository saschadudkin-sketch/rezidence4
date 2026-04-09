/**
 * GroupedReqList — virtualized grouped request list.
 *
 * PERF-VL: Uses @tanstack/react-virtual to render only the visible slice
 * of the card list. Virtualization activates when the flattened item count
 * exceeds VIRTUALIZE_THRESHOLD (30). Below the threshold the list renders
 * normally — avoids virtualizer overhead for typical short lists.
 *
 * Layout: groups are flattened into a single [{type:'header'}|{type:'card'}]
 * array so the virtualizer can handle grouped output without nested scrollers.
 * Card heights are measured dynamically via measureElement so that expanded
 * cards (which grow significantly) are handled correctly.
 */

import { useRef, useMemo, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { groupReqs } from '../utils';
import { ReqCard } from './ReqCard';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { UserRole } from '../store/slices/usersSlice';

const VIRTUALIZE_THRESHOLD = 30; // items; below this, render normally

/**
 * Flatten grouped requests into a single array of typed items.
 * @param {Array} groups — output of groupReqs()
 * @param {boolean} showHeaders — whether to include header items
 * @returns {Array<{type:'header',label:string}|{type:'card',req,staggerIdx:number}>}
 */
type FlatGroupItem =
  | { type: 'header'; label: string }
  | { type: 'card'; req: AppRequest; staggerIdx: number };

type GroupedReqListProps = {
  reqs: AppRequest[];
  userRole: UserRole | string;
  userName: string;
  userId: string;
  onRepeat?: (req: AppRequest) => void;
  onEdit?: (req: AppRequest) => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
  highlightId?: string | null;
  onHighlighted?: () => void;
};

function flattenGroups(groups: Array<{ label: string; items: AppRequest[] }>, showHeaders: boolean): FlatGroupItem[] {
  const items: FlatGroupItem[] = [];
  for (const g of groups) {
    if (showHeaders) items.push({ type: 'header', label: g.label });
    for (let i = 0; i < g.items.length; i++) {
      items.push({ type: 'card', req: g.items[i], staggerIdx: i });
    }
  }
  return items;
}

// ─── VirtualGroupedReqList ───────────────────────────────────────────────────

function VirtualGroupedReqList({ items, userRole, userName, userId, onRepeat, onEdit, onDelete, onCancel, highlightId, onHighlighted }: { items: FlatGroupItem[] } & Omit<GroupedReqListProps, 'reqs'>) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => items[i].type === 'header' ? 32 : 72,
    overscan: 5,
    // measureElement: auto-sizes items as they mount/change (handles expanded cards)
    measureElement: (el) => el?.getBoundingClientRect().height ?? 72,
  });

  const measureRef = useCallback((el) => {
    if (el) virtualizer.measureElement(el);
  }, [virtualizer]);

  return (
    <div ref={parentRef} className="req-list req-list--virtual">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = items[vItem.index];
          return (
            <div
              key={vItem.key}
              ref={measureRef}
              data-index={vItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {item.type === 'header' ? (
                <div className="group-date-label">{item.label}</div>
              ) : (
                <ReqCard
                  req={item.req}
                  staggerIdx={item.staggerIdx}
                  userRole={userRole}
                  userName={userName}
                  userId={userId}
                  onRepeat={onRepeat}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCancel={onCancel}
                  highlightId={highlightId}
                  onHighlighted={onHighlighted}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── GroupedReqList ──────────────────────────────────────────────────────────
// PERF-03: memo prevents re-renders when parent re-renders but props haven't changed.
// Critical because GroupedReqList is rendered by multiple role views and can receive
// large request arrays — re-rendering the virtualized list is expensive.
export const GroupedReqList = memo(function GroupedReqList({ reqs, userRole, userName, userId, onRepeat, onEdit, onDelete, onCancel, highlightId, onHighlighted }: GroupedReqListProps) {
  const groups = useMemo(() => groupReqs(reqs), [reqs]);
  const showHeaders = groups.length > 1 || (groups[0] && groups[0].label !== 'Сегодня');
  const flatItems = useMemo(() => flattenGroups(groups, showHeaders), [groups, showHeaders]);
  if (groups.length === 0) return null;

  // Use virtualization for large lists only
  if (flatItems.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualGroupedReqList
        items={flatItems}
        userRole={userRole}
        userName={userName}
        userId={userId}
        onRepeat={onRepeat}
        onEdit={onEdit}
        onDelete={onDelete}
        onCancel={onCancel}
        highlightId={highlightId}
        onHighlighted={onHighlighted}
      />
    );
  }

  // Normal (non-virtualized) render for short lists
  return (
    <div className="req-list">
      {groups.map(g => (
        <div key={g.label}>
          {showHeaders && <div className="group-date-label">{g.label}</div>}
          {g.items.map((r, i) => (
            <ReqCard key={r.id} req={r} staggerIdx={i} userRole={userRole} userName={userName} userId={userId}
              onRepeat={onRepeat}
              onEdit={onEdit}
              onDelete={onDelete}
              onCancel={onCancel}
              highlightId={highlightId}
              onHighlighted={onHighlighted}
            />
          ))}
        </div>
      ))}
    </div>
  );
});
