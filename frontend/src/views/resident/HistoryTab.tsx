import { memo } from 'react';
import { ReqCard } from '../../requests/ReqCard';
import StateBlock from '../../ui/StateBlock';
import { getViewStateCopy } from '../../ui/viewStateContract';

const HistoryTab = memo(function HistoryTab({ user, onRepeatPass, onRepeatTech, computed }) {
  const { completedRequests } = computed;
  const historyEmptyCopy = getViewStateCopy('history', 'empty');

  if (completedRequests.length === 0) {
    return (
      <StateBlock
        type="empty"
        title={historyEmptyCopy.title}
        subtitle={historyEmptyCopy.subtitle}
      />
    );
  }

  return (
    <div className="req-list">
      {completedRequests.map((r, i) => (
        <ReqCard
          key={r.id}
          req={r}
          staggerIdx={i}
          userRole={user.role}
          userName={user.name}
          userId={user.uid}
          onRepeat={r.type === 'tech' ? onRepeatTech : onRepeatPass}
        />
      ))}
    </div>
  );
});

export default HistoryTab;
