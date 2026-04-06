import { AppIcon } from '../ui/AppIcon';

export function SmartActionRail({ action, feedback, onAction }) {
  if (!action) return null;
  return (
    <div className="onboarding-hint smart-action-rail" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="ticket" size={14} /></span>
      <span className="onboarding-hint-text">
        <strong>{action.title}.</strong> {action.subtitle}
        {feedback ? ` ${feedback}` : ''}
      </span>
      <button className="btn-outline btn-hdr" onClick={onAction}>{action.cta}</button>
    </div>
  );
}
