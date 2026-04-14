import { useMemo } from 'react';
import { ReqCard } from '../../requests/ReqCard.jsx';
import { AppIcon } from '../../ui/AppIcon.jsx';
import StateBlock from '../../ui/StateBlock.jsx';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { VirtualList } from '../../ui/VirtualList.jsx';
import type { AppRequest, RequestType } from '../../store/slices/requestsSlice';
import type { AppUser } from '../../store/slices/usersSlice';

type ConciergeTechTabProps = {
  user: AppUser;
  query: string;
  setQuery: (value: string) => void;
  setActiveTab: (tab: string) => void;
  setModal: (value: { type: RequestType; cat?: string; data?: Record<string, unknown> } | null) => void;
  allTech: AppRequest[];
  debouncedQuery: string;
};

export function ConciergeTechTab({
  user,
  query,
  setQuery,
  setActiveTab,
  setModal,
  allTech,
  debouncedQuery,
}: ConciergeTechTabProps) {
  const emptyCopy = useMemo(() => getViewStateCopy('security_tech', 'empty'), []);

  return (
    <>
      <div className="type-grid">
        {[
          { key: 'electrician', iconName: 'tools', label: 'Электрик' },
          { key: 'plumber', iconName: 'tools', label: 'Сантехник' },
        ].map(({ key, iconName, label }) => (
          <button key={key} type="button" className="type-card" onClick={() => setModal({ type: 'tech', cat: key })}>
            <div className="type-icon"><AppIcon name={iconName} size={20} /></div>
            <div className="type-label">{label}</div>
          </button>
        ))}
        <button type="button" className="type-card" onClick={() => setActiveTab('templates')}>
          <div className="type-icon"><AppIcon name="file" size={20} /></div>
          <div className="type-label">Шаблоны</div>
        </button>
      </div>
      <div className="search-wrap">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" aria-label="Поиск заявок" placeholder="Поиск..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {allTech.length > 0 && (
        <VirtualList
          items={allTech}
          renderItem={(req, index) => (
            <ReqCard key={req.id} req={req} staggerIdx={index} userRole={user.role} userName={user.name} userId={user.uid} />
          )}
          estimateSize={110}
          className="req-list"
        />
      )}
      {allTech.length === 0 && (
        <StateBlock
          type="empty"
          title={debouncedQuery ? 'Ничего не найдено' : emptyCopy.title}
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : emptyCopy.subtitle}
        />
      )}
    </>
  );
}
