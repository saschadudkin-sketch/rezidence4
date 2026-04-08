import { AppIcon } from './AppIcon';

// UI-03: 'history' (clock icon) was semantically incorrect for loading state.
// 'refresh' (circular arrow) correctly communicates "data is being fetched".
const ICON_BY_TYPE = {
  loading: 'refresh',
  empty: 'info',
  error: 'alert',
};

const EYEBROW_BY_TYPE = {
  loading: 'Обновление',
  empty: 'Готово к началу',
  error: 'Требуется действие',
};

type StateBlockProps = {
  type?: 'loading' | 'empty' | 'error' | string;
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function StateBlock({
  type = 'empty',
  title,
  subtitle,
  actionLabel,
  onAction,
}: StateBlockProps) {
  const icon = ICON_BY_TYPE[type] || 'history';
  const eyebrow = EYEBROW_BY_TYPE[type] || 'Статус';
  return (
    <div className={`state-block state-${type}`} role="status" aria-live="polite">
      <div className="state-icon-shell">
        <div className="state-icon"><AppIcon name={icon} size={30} /></div>
      </div>
      <div className="state-eyebrow">{eyebrow}</div>
      {title ? <div className="state-title">{title}</div> : null}
      {subtitle ? <div className="state-sub">{subtitle}</div> : null}
      {onAction && actionLabel ? (
        <button className="btn-outline state-action" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  );
}
