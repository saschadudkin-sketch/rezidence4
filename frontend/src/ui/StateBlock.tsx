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
  return (
    <div className={`state-block state-${type}`} role="status" aria-live="polite">
      {title ? <div className="state-title">{title}</div> : null}
      {subtitle ? <div className="state-sub">{subtitle}</div> : null}
      {onAction && actionLabel ? (
        <button className="btn-outline state-action" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  );
}
