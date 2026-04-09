import { memo } from 'react';
import { ReqCard } from '../../requests/ReqCard';
import StateBlock from '../../ui/StateBlock';
import { getViewStateCopy } from '../../ui/viewStateContract';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { UserRole } from '../../store/slices/usersSlice';

type HistoryTabProps = {
  user: { role: UserRole | string; name: string; uid: string };
  onRepeatPass: (request: AppRequest) => void;
  onRepeatTech: (request: AppRequest) => void;
  computed: { completedRequests: AppRequest[] };
};

const HistoryTab = memo(function HistoryTab({ user, onRepeatPass, onRepeatTech, computed }: HistoryTabProps) {
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
