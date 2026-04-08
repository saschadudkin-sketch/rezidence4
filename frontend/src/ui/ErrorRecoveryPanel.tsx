import { AppIcon } from './AppIcon';

interface ErrorRecoveryPanelProps {
  message: string;
  onRetry: () => void;
  onFallback?: () => void;
  fallbackLabel?: string;
}

export function ErrorRecoveryPanel({
  message,
  onRetry,
  onFallback,
  fallbackLabel = 'Открыть офлайн-очередь',
}: ErrorRecoveryPanelProps) {
  return (
    <div className="error-recovery-panel" role="alert" aria-live="assertive">
      <div className="error-recovery-message">
        <AppIcon name="alert" size={14} /> {message}
      </div>
      <div className="error-recovery-actions">
        <button className="btn-outline" onClick={onRetry}>Повторить</button>
        {onFallback && (
          <button className="btn-outline" onClick={onFallback}>{fallbackLabel}</button>
        )}
      </div>
    </div>
  );
}

export default ErrorRecoveryPanel;
