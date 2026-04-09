import { memo, useCallback, useMemo } from 'react';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import { useDebounce } from '../../hooks/useDebounce';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { useUrlSearchParams } from '../../hooks/useUrlSearchParams';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { UserRole } from '../../store/slices/usersSlice';

type TechTabProps = {
  user: { role: UserRole | string; name: string; uid: string };
  techFilter: string;
  setTechFilter: (value: string) => void;
  setModal: (value: { type: string; cat: string }) => void;
  onRepeatTech: (request: AppRequest) => void;
  onEdit: (request: AppRequest) => void;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
  computed: {
    filteredTech: AppRequest[];
  };
};

const TECH_CARDS: Array<[string, string, string]> = [
  ['electrician', 'alert', 'Электрик'],
  ['plumber', 'tools', 'Сантехник'],
];

const FILTERS: Array<[string, string]> = [
  ['active', 'Активные'],
  ['all', 'Все'],
];

const TechTab = memo(function TechTab({
  user,
  techFilter,
  setTechFilter,
  setModal,
  onRepeatTech,
  onEdit,
  onDelete,
  onCancel,
  computed,
}: TechTabProps) {
  const { filteredTech } = computed;

  const [searchParams, setSearchParams] = useUrlSearchParams();
  const query = searchParams.get('techQ') || '';
  const debouncedQuery = useDebounce(query, 250);
  const techEmptyCopy = getViewStateCopy('tech', 'empty');

  const updateTechSearch = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value.trim()) next.delete('techQ');
    else next.set('techQ', value.trim());
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const matchesQuery = useCallback((request: AppRequest) => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;

    return [request.comment, request.category].some((value) =>
      typeof value === 'string' && value.toLowerCase().includes(normalizedQuery),
    );
  }, [debouncedQuery]);

  const visibleTech = useMemo(() => filteredTech.filter(matchesQuery), [filteredTech, matchesQuery]);

  return (
    <>
      <div className="type-grid">
        {TECH_CARDS.map(([key, iconName, label]) => (
          <button
            key={key}
            type="button"
            className="type-card"
            onClick={() => setModal({ type: 'tech', cat: key })}
          >
            <div className="type-icon"><AppIcon name={iconName} /></div>
            <div className="type-label">{label}</div>
          </button>
        ))}
      </div>

      <div className="tech-filter-row">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`date-pill${techFilter === key ? ' active' : ''}`}
            onClick={() => setTechFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredTech.length > 0 && (
        <div className="search-wrap u-mb8">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input
            className="search-inp"
            placeholder="Комментарий или тип работ"
            value={query}
            onChange={(event) => updateTechSearch(event.target.value)}
          />
        </div>
      )}

      {visibleTech.length === 0 ? (
        <StateBlock
          type="empty"
          title={debouncedQuery ? 'Ничего не найдено' : techEmptyCopy.title}
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : techEmptyCopy.subtitle}
        />
      ) : (
        <OperationalRequestList
          items={visibleTech}
          userRole={user.role}
          userName={user.name}
          userId={user.uid}
          onRepeat={onRepeatTech}
          onEdit={onEdit}
          onDelete={onDelete}
          onCancel={onCancel}
        />
      )}
    </>
  );
});

export default TechTab;
