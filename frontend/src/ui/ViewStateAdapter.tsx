import StateBlock from './StateBlock';
import { getViewStateCopy, type ViewEntity, type ViewStateKind } from './viewStateContract';

interface ViewStateAdapterProps {
  entity: ViewEntity;
  state: ViewStateKind;
  actionLabel?: string;
  onAction?: () => void;
  title?: string;
  subtitle?: string;
}

export function ViewStateAdapter({
  entity,
  state,
  actionLabel,
  onAction,
  title,
  subtitle,
}: ViewStateAdapterProps) {
  const copy = getViewStateCopy(entity, state);

  return (
    <StateBlock
      type={state}
      title={title || copy.title}
      subtitle={subtitle || copy.subtitle}
      actionLabel={state === 'error' ? actionLabel : undefined}
      onAction={state === 'error' ? onAction : undefined}
    />
  );
}

export default ViewStateAdapter;
