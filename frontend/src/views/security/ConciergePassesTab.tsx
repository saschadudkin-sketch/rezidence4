import { useMemo } from 'react';
import { ReqCard } from '../../requests/ReqCard.jsx';
import { AppIcon } from '../../ui/AppIcon.jsx';
import StateBlock from '../../ui/StateBlock.jsx';
import PageActionBar from '../../ui/PageActionBar.tsx';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { VirtualList } from '../../ui/VirtualList.jsx';
import type { AppRequest, RequestType } from '../../store/slices/requestsSlice';
import type { AppUser } from '../../store/slices/usersSlice';

type ConciergePassesTabProps = {
  user: AppUser;
  query: string;
  setQuery: (value: string) => void;
  showAll: boolean;
  setShowAll: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowScan: (value: boolean) => void;
  setModal: (value: { type: RequestType; cat?: string; data?: Record<string, unknown> } | null) => void;
  allPasses: AppRequest[];
  debouncedQuery: string;
};

const passIcons: Array<{ key: string; iconName: string; label: string }> = [
  { key: 'guest', iconName: 'users', label: 'Гость' },
  { key: 'courier', iconName: 'courier', label: 'Курьер' },
  { key: 'taxi', iconName: 'taxi', label: 'Такси' },
  { key: 'car', iconName: 'car', label: 'Авто' },
  { key: 'master', iconName: 'tools', label: 'Мастер' },
];

export function ConciergePassesTab({
  user,
  query,
  setQuery,
  showAll,
  setShowAll,
  setShowScan,
  setModal,
  allPasses,
  debouncedQuery,
}: ConciergePassesTabProps) {
  const emptyCopy = useMemo(() => getViewStateCopy('security_passes', 'empty'), []);

  return (
    <>
      <div className="concierge-role-hint" role="note">
        <AppIcon name="info" size={14} className="u-inline-icon" />
        <span>Консьерж создаёт заявки, находит пропуска и сканирует QR-коды. Подтверждение и отметка прибытия остаются за охраной.</span>
      </div>
      <PageActionBar
        className="u-mb12"
        primaryLabel="Сканировать QR-код"
        onPrimary={() => setShowScan(true)}
        secondary={[
          { label: 'Создать пропуск гостю', onClick: () => setModal({ type: 'pass', cat: 'guest' }) },
        ]}
      />
      <div className="search-wrap">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" aria-label="Поиск пропусков" placeholder="Поиск..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="type-grid">
        {passIcons.map(({ key, iconName, label }) => (
          <button key={key} type="button" className="type-card" onClick={() => setModal({ type: 'pass', cat: key })}>
            <div className="type-icon"><AppIcon name={iconName} size={20} /></div>
            <div className="type-label">{label}</div>
          </button>
        ))}
      </div>
      <div className="u-flex-center u-mb16">
        <button className={`date-pill${showAll ? ' active' : ''}`} onClick={() => setShowAll((open) => !open)}>
          {showAll ? '▴ Скрыть все пропуска' : '▾ Все пропуска'}
        </button>
      </div>
      {showAll && allPasses.length > 0 && (
        <VirtualList
          items={allPasses}
          renderItem={(req, index) => (
            <ReqCard key={req.id} req={req} staggerIdx={index} userRole={user.role} userName={user.name} userId={user.uid} />
          )}
          estimateSize={110}
          className="req-list"
        />
      )}
      {showAll && allPasses.length === 0 && (
        <StateBlock
          type="empty"
          title={debouncedQuery ? 'Ничего не найдено' : emptyCopy.title}
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : emptyCopy.subtitle}
        />
      )}
    </>
  );
}
