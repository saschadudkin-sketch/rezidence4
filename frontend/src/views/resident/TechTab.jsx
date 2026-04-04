import { memo } from 'react';
import { GroupedReqList } from '../../requests/ReqCard.jsx';
import { AppIcon } from '../../ui/AppIcon.jsx';
import StateBlock from '../../ui/StateBlock.jsx';

const TechTab = memo(function TechTab({
  user, techFilter, setTechFilter, setModal,
  onRepeatTech, onEdit, onDelete, onCancel, computed,
}) {
  const { filteredTech } = computed;

  return (
    <>
      <div className="type-grid">
        {[['electrician','alert','Электрик'],['plumber','tools','Сантехник']].map(([k, iconName, l]) => (
          <button key={k} type="button" className="type-card"
            onClick={() => setModal({ type: 'tech', cat: k })}>
            <div className="type-icon"><AppIcon name={iconName} /></div>
            <div className="type-label">{l}</div>
          </button>
        ))}
      </div>
      <div className="tech-filter-row">
        {[['active','Активные'],['all','Все']].map(([k, l]) => (
          <button key={k} className={'date-pill' + (techFilter === k ? ' active' : '')} onClick={() => setTechFilter(k)}>{l}</button>
        ))}
      </div>
      {filteredTech.length === 0
        ? <StateBlock
            type="empty"
            title="Заявок нет"
            subtitle="Нажмите на категорию выше, чтобы вызвать техслужбу"
          />
        : <GroupedReqList
            reqs={filteredTech} userRole={user.role} userName={user.name} userId={user.uid}
            onRepeat={onRepeatTech}
            onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
          />
      }
    </>
  );
});

export default TechTab;
