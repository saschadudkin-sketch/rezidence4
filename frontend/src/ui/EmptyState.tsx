/**
 * EmptyState.jsx — P-04: Reusable empty-state component.
 *
 * Use whenever a list, table, or section has no data to show.
 * Provides a consistent visual pattern: icon + title + optional
 * description + optional CTA button.
 *
 * Usage:
 *   <EmptyState
 *     icon="file"
 *     title="Нет заявок"
 *     description="Создайте первую заявку для гостя или службы"
 *     ctaLabel="Создать заявку"
 *     onCta={() => setShowCreate(true)}
 *   />
 */

import { AppIcon } from './AppIcon';

export function EmptyState({
  icon = 'info',
  title,
  description,
  ctaLabel,
  onCta,
  className = '',
}) {
  return (
    <div className={`empty-state${className ? ' ' + className : ''}`} role="status">
      <div className="empty-state-icon" aria-hidden="true">
        <AppIcon name={icon} size={36} />
      </div>
      {title && (
        <div className="empty-state-title">{title}</div>
      )}
      {description && (
        <div className="empty-state-desc">{description}</div>
      )}
      {ctaLabel && onCta && (
        <button className="btn-outline empty-state-cta" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
