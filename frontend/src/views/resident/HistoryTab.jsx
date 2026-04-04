import { memo } from 'react';
import { ReqCard } from '../../requests/ReqCard.jsx';
import StateBlock from '../../ui/StateBlock.jsx';

const HistoryTab = memo(function HistoryTab({ user, onRepeatPass, onRepeatTech, computed }) {
  const { completedRequests } = computed;

  if (completedRequests.length === 0) {
    return (
      <StateBlock
        type="empty"
        title="Нет завершённых заявок"
        subtitle="Здесь появятся завершённые, отклонённые и отменённые заявки"
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
