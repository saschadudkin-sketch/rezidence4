import { memo, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import SectionHeader from '../../ui/SectionHeader';
import PageActionBar from '../../ui/PageActionBar';
import { useDebounce } from '../../hooks/useDebounce';
import { getViewStateCopy } from '../../ui/viewStateContract';

type PassesTabProps = {
  user: { role: string; name: string; uid: string };
  passFilter: string;
  setPassFilter: (value: string) => void;
  setModal: (value: { type: string; cat: string }) => void;
  setActiveTab: (tab: string) => void;
  onRepeatPass: (request: unknown) => void;
  onEdit: (request: unknown) => void;
  onDelete: (id: unknown) => void;
  onCancel: (id: unknown) => void;
  computed: {
    myPasses: Array<Record<string, unknown>>;
    scheduledPasses: Array<Record<string, unknown>>;
    filteredPasses: Array<Record<string, unknown>>;
    tempCount: number;
    permCount: number;
  };
};

const PassesTab = memo(function PassesTab({
  user, passFilter, setPassFilter, setModal, setActiveTab,
  onRepeatPass, onEdit, onDelete, onCancel, computed,
}: PassesTabProps) {
  const { myPasses, scheduledPasses, filteredPasses, tempCount, permCount } = computed;
  const scheduledCount = scheduledPasses.length;

  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('passQ') || '';
  const [showTypePicker, setShowTypePicker] = useState(false);
  const debouncedQuery = useDebounce(query, 250);
  const isOwnerDashboard = user.role === 'owner';

  const updatePassSearch = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value.trim()) next.delete('passQ');
    else next.set('passQ', value.trim());
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const matchQ = useCallback((r) => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return true;
    return [r.visitorName, r.carPlate, r.comment].some((v) => v && v.toLowerCase().includes(q));
  }, [debouncedQuery]);

  const visiblePasses = useMemo(() => filteredPasses.filter(matchQ), [filteredPasses, matchQ]);
  const visibleScheduled = useMemo(() => scheduledPasses.filter(matchQ), [scheduledPasses, matchQ]);
  const passesEmptyCopy = getViewStateCopy('passes', 'empty');

  const passIcons = user.role === 'contractor'
    ? [['worker', 'tools', 'Рабочий'], ['team', 'users', 'Бригада'], ['delivery', 'car', 'Доставка'], ['car', 'car', 'Авто']]
    : [['guest', 'users', 'Гость'], ['courier', 'file', 'Курьер'], ['taxi', 'car', 'Такси'], ['car', 'car', 'Авто'], ['master', 'tools', 'Мастер']];

  return (
    <>
      <PageActionBar
        className="u-mb12"
        primaryLabel="Создать пропуск"
        onPrimary={() => setModal({ type: 'pass', cat: user.role === 'contractor' ? 'worker' : 'guest' })}
        secondary={[
          ...(isOwnerDashboard ? [{ label: showTypePicker ? 'Скрыть категории' : 'Выбрать тип', onClick: () => setShowTypePicker((v) => !v) }] : []),
          { label: 'Открыть шаблоны', onClick: () => setActiveTab('templates') },
        ]}
      />

      {(!isOwnerDashboard || showTypePicker) && (
        <div className="type-grid">
          {passIcons.map(([k, iconName, l]) => (
            <button key={k} type="button" className="type-card" onClick={() => setModal({ type: 'pass', cat: k })}>
              <div className="type-icon"><AppIcon name={iconName} /></div>
              <div className="type-label">{l}</div>
            </button>
          ))}
          <button type="button" onClick={() => setActiveTab('templates')} className="type-card">
            <div className="type-icon"><AppIcon name="file" /></div>
            <div className="type-label">Шаблоны</div>
          </button>
        </div>
      )}

      {myPasses.length > 0 && (
        <div className="search-wrap u-mb8">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input className="search-inp" placeholder="Имя, авто или комментарий" value={query} onChange={(e) => updatePassSearch(e.target.value)} />
        </div>
      )}

      {myPasses.length > 0 && (
        <div className="pass-filter-pills">
          {[
            ['active', 'Активные', 0],
            ['scheduled', 'Запланированные', scheduledCount],
            ['all', 'Все', myPasses.length],
            ['temporary', 'Временные', tempCount],
            ['permanent', 'Постоянные', permCount],
            ['once', 'Разовые', myPasses.length - tempCount - permCount],
          ].map(([k, l, c]) =>
            c > 0 || k === 'all' || k === 'active' ? (
              <button key={k} className={`date-pill${passFilter === k ? ' active' : ''}`} onClick={() => setPassFilter(k)}>
                {l}{c > 0 && k !== 'all' && k !== 'active' ? ` (${c})` : ''}
              </button>
            ) : null,
          )}
        </div>
      )}

      {visiblePasses.length === 0 && myPasses.length === 0 ? (
        <StateBlock
          type="empty"
          title={passesEmptyCopy.title}
          subtitle={passesEmptyCopy.subtitle}
          actionLabel="Создать пропуск"
          onAction={() => setModal({ type: 'pass', cat: 'guest' })}
        />
      ) : visiblePasses.length === 0 && visibleScheduled.length === 0 ? (
        <StateBlock
          type="empty"
          title={debouncedQuery ? 'Ничего не найдено' : passesEmptyCopy.title}
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : 'Нет пропусков в этой категории'}
        />
      ) : (
        <>
          {visibleScheduled.length > 0 && passFilter !== 'scheduled' && (
            <div className="u-mb-12">
              <SectionHeader title="Запланированные" count={visibleScheduled.length} />
              <OperationalRequestList
                items={visibleScheduled}
                userRole={user.role}
                userName={user.name}
                userId={user.uid}
                onRepeat={onRepeatPass}
                onEdit={onEdit}
                onDelete={onDelete}
                onCancel={onCancel}
              />
            </div>
          )}
          <OperationalRequestList
            items={visiblePasses}
            userRole={user.role}
            userName={user.name}
            userId={user.uid}
            onRepeat={onRepeatPass}
            onEdit={onEdit}
            onDelete={onDelete}
            onCancel={onCancel}
          />
        </>
      )}
    </>
  );
});

export default PassesTab;
