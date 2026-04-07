import { memo, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import PageActionBar from '../../ui/PageActionBar';
import { useDebounce } from '../../hooks/useDebounce';
import { getViewStateCopy } from '../../ui/viewStateContract';

const TechTab = memo(function TechTab({
  user, techFilter, setTechFilter, setModal,
  onRepeatTech, onEdit, onDelete, onCancel, computed,
}) {
  const { filteredTech } = computed;

  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('techQ') || '';
  const debouncedQuery = useDebounce(query, 250);
  const updateTechSearch = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value.trim()) next.delete('techQ');
    else next.set('techQ', value.trim());
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const matchQ = useCallback((r) => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return true;
    return [r.comment, r.category].some(v => v && v.toLowerCase().includes(q));
  }, [debouncedQuery]);
  const visibleTech = useMemo(() => filteredTech.filter(matchQ), [filteredTech, matchQ]);
  const techEmptyCopy = getViewStateCopy('tech', 'empty');

  return (
    <>
      <PageActionBar
        className="u-mb12"
        primaryLabel="Создать техзаявку"
        onPrimary={() => setModal({ type: 'tech', cat: 'electrician' })}
      />
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
      {filteredTech.length > 0 && (
        <div className="search-wrap u-mb8">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input className="search-inp" placeholder="Комментарий или тип работ" value={query} onChange={e => updateTechSearch(e.target.value)} />
        </div>
      )}
      {visibleTech.length === 0
        ? <StateBlock
            type="empty"
            title={debouncedQuery ? 'Ничего не найдено' : techEmptyCopy.title}
            subtitle={debouncedQuery ? 'Попробуйте другой запрос' : techEmptyCopy.subtitle}
          />
        : <OperationalRequestList
            items={visibleTech} userRole={user.role} userName={user.name} userId={user.uid}
            onRepeat={onRepeatTech}
            onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
          />
      }
    </>
  );
});

export default TechTab;
