import { AppIcon } from '../ui/AppIcon';
import type { WorkflowAction } from './roleWorkflow';

type SmartActionRailProps = {
  action: WorkflowAction | null;
  feedback?: string;
  onAction?: () => void;
};

export function SmartActionRail({ action, feedback, onAction }: SmartActionRailProps) {
  if (!action) return null;
  return (
    <div className="onboarding-hint smart-action-rail" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="ticket" size={14} /></span>
      <span className="onboarding-hint-text">
        <strong>{action.title}.</strong> {action.subtitle}
        {feedback ? ` ${feedback}` : ''}
      </span>
      {onAction && action.cta ? <button className="btn-outline btn-hdr" onClick={onAction}>{action.cta}</button> : null}
    </div>
  );
}
