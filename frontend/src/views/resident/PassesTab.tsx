import { memo, useCallback, useMemo } from 'react';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import SectionHeader from '../../ui/SectionHeader';
import { useDebounce } from '../../hooks/useDebounce';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { useUrlSearchParams } from '../../hooks/useUrlSearchParams';

type PassesTabProps = {
  user: { role: string; name: string; uid: string };
  passFilter: string;
  setPassFilter: (value: string) => void;
  setModal: (value: { type: string; cat: string }) => void;
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
  user,
  passFilter,
  setPassFilter,
  setModal,
  onRepeatPass,
  onEdit,
  onDelete,
  onCancel,
  computed,
}: PassesTabProps) {
  const { myPasses, scheduledPasses, filteredPasses, tempCount, permCount } = computed;
  const scheduledCount = scheduledPasses.length;

  const [searchParams, setSearchParams] = useUrlSearchParams();
  const query = searchParams.get('passQ') || '';
  const debouncedQuery = useDebounce(query, 250);

  const updatePassSearch = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value.trim()) next.delete('passQ');
    else next.set('passQ', value.trim());
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const matchQuery = useCallback((request: Record<string, unknown>) => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;

    return [request.visitorName, request.carPlate, request.comment].some((value) =>
      typeof value === 'string' && value.toLowerCase().includes(normalizedQuery),
    );
  }, [debouncedQuery]);

  const visiblePasses = useMemo(() => filteredPasses.filter(matchQuery), [filteredPasses, matchQuery]);
  const visibleScheduled = useMemo(() => scheduledPasses.filter(matchQuery), [scheduledPasses, matchQuery]);
  const passesEmptyCopy = getViewStateCopy('passes', 'empty');

  const passIcons = user.role === 'contractor'
    ? [
        ['worker', 'tools', 'Рабочий'],
        ['team', 'users', 'Бригада'],
        ['delivery', 'car', 'Доставка'],
        ['car', 'car', 'Авто'],
      ]
    : [
        ['guest', 'users', 'Гость'],
        ['courier', 'courier', 'Курьер'],
        ['taxi', 'taxi', 'Такси'],
        ['car', 'car', 'Авто'],
        ['master', 'tools', 'Мастер'],
      ];

  return (
    <>
      <div className="type-grid">
        {passIcons.map(([key, iconName, label]) => (
          <button
            key={key}
            type="button"
            className="type-card"
            onClick={() => setModal({ type: 'pass', cat: key as string })}
          >
            <div className="type-icon"><AppIcon name={iconName as string} /></div>
            <div className="type-label">{label}</div>
          </button>
        ))}
      </div>

      {myPasses.length > 0 && (
        <div className="search-wrap u-mb8">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input
            className="search-inp"
            placeholder="Имя, авто или комментарий"
            value={query}
            onChange={(event) => updatePassSearch(event.target.value)}
          />
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
          ].map(([key, label, count]) =>
            count > 0 || key === 'all' || key === 'active' ? (
              <button
                key={key}
                className={`date-pill${passFilter === key ? ' active' : ''}`}
                onClick={() => setPassFilter(key as string)}
              >
                {label}
                {count > 0 && key !== 'all' && key !== 'active' ? ` (${count})` : ''}
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
