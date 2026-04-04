import { memo } from 'react';
import { GroupedReqList } from '../../requests/ReqCard.jsx';
import { AppIcon } from '../../ui/AppIcon.jsx';
import StateBlock from '../../ui/StateBlock.jsx';
import SectionHeader from '../../ui/SectionHeader.jsx';

const INACTIVE_STATUSES = new Set(['cancelled', 'rejected', 'expired']);

const PassesTab = memo(function PassesTab({
  user, passFilter, setPassFilter, setModal, setActiveTab,
  onRepeatPass, onEdit, onDelete, onCancel, computed,
}) {
  const { myPasses, scheduledPasses, filteredPasses, tempCount, permCount } = computed;
  const scheduledCount = scheduledPasses.length;

  const passIcons = user.role === 'contractor'
    ? [['worker','tools','Рабочий'],['team','users','Бригада'],['delivery','car','Доставка'],['car','car','Авто']]
    : [['guest','users','Гость'],['courier','file','Курьер'],['taxi','car','Такси'],['car','car','Авто'],['master','tools','Мастер']];

  return (
    <>
      <div className="type-grid">
        {passIcons.map(([k, iconName, l]) => (
          <button key={k} type="button" className="type-card"
            onClick={() => setModal({ type: 'pass', cat: k })}>
            <div className="type-icon"><AppIcon name={iconName} /></div>
            <div className="type-label">{l}</div>
          </button>
        ))}
        <button type="button"
          onClick={() => setActiveTab('templates')}
          className="type-card">
          <div className="type-icon"><AppIcon name="file" /></div>
          <div className="type-label">Шаблоны</div>
        </button>
      </div>
      {myPasses.length > 0 && (
        <div className="pass-filter-pills">
          {[
            ['active',    'Активные',           0],
            ['scheduled', 'Запланированные', scheduledCount],
            ['all',       'Все',                myPasses.length],
            ['temporary', 'Временные',       tempCount],
            ['permanent', 'Постоянные',       permCount],
            ['once',      'Разовые',             myPasses.length - tempCount - permCount],
          ].map(([k, l, c]) =>
            c > 0 || k === 'all' || k === 'active' ? (
              <button key={k}
                className={'date-pill' + (passFilter === k ? ' active' : '')}
                onClick={() => setPassFilter(k)}>
                {l}{c > 0 && k !== 'all' && k !== 'active' ? ` (${c})` : ''}
              </button>
            ) : null
          )}
        </div>
      )}
      {filteredPasses.length === 0 && myPasses.length === 0
        ? <StateBlock
            type="empty"
            title="Пропусков пока нет"
            subtitle="Создайте первый пропуск для гостя или курьера"
            actionLabel="Создать пропуск"
            onAction={() => setModal({ type: 'pass', cat: 'guest' })}
          />
        : filteredPasses.length === 0
          ? <StateBlock type="empty" title="Нет пропусков в этой категории" />
          : <>
              {scheduledPasses.length > 0 && passFilter !== 'scheduled' && (
                <div className="u-mb-12">
                  <SectionHeader title="Запланированные" count={scheduledPasses.length} />
                  <GroupedReqList reqs={scheduledPasses} userRole={user.role} userName={user.name} userId={user.uid}
                    onRepeat={onRepeatPass}
                    onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
                  />
                </div>
              )}
              <GroupedReqList
                reqs={filteredPasses} userRole={user.role} userName={user.name} userId={user.uid}
                onRepeat={onRepeatPass}
                onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
              />
            </>
      }
    </>
  );
});

export default PassesTab;
