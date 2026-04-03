/**
 * SkeletonList.jsx — UI-04: плейсхолдер загрузки списка заявок.
 * Устраняет пустой экран при первичной загрузке данных (perceived performance).
 *
 * Использование:
 *   import { SkeletonList } from '../ui/SkeletonList';
 *   if (isLoading && items.length === 0) return <SkeletonList />;
 */

export function SkeletonList({ count = 3 }) {
  return (
    <div className="req-list" aria-busy="true" aria-label="Загрузка...">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="req-card req-card--skeleton" aria-hidden="true">
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line skeleton-line--sub" />
          <div className="skeleton-line skeleton-line--badge" />
        </div>
      ))}
    </div>
  );
}
