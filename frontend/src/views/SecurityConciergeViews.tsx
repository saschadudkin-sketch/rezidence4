import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRequests } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce';
import { sortReqs, filterByPeriod } from '../utils.js';
import { isPassRequest, isTechRequest } from '../constants/requestPredicates.js';
import { ReqCard } from '../requests/ReqCard.jsx';
import { CreateModal } from '../requests/CreateModal.jsx';
import { ScanQRModal } from '../requests/ScanQRModal.jsx';
import { ChatView } from '../chat/ChatView.jsx';
import { MyTemplates } from '../perms/PermsList.jsx';
import BlacklistView from './BlacklistView.jsx';
import VisitLogView from './VisitLogView.jsx';
import ResidentsView from './ResidentsView.jsx';
import { AppIcon } from '../ui/AppIcon.jsx';
import StateBlock from '../ui/StateBlock.jsx';
import PageActionBar from '../ui/PageActionBar.tsx';
import { getViewStateCopy } from '../ui/viewStateContract';
import { VirtualList } from '../ui/VirtualList.jsx';
import GuardPostMode from './GuardPostMode.jsx';
import { SecurityPassesPane } from './security/SecurityPassesPane';
import { SecurityPermsList } from './security/SecurityPermsList';
import type { AppRequest, RequestType } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { Template } from '../store/slices/permsSlice';

type ModalState = {
  type: RequestType;
  cat?: string;
  data?: Record<string, unknown>;
} | null;

type ConciergeViewProps = {
  user: AppUser;
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

type SecurityViewProps = {
  user: AppUser;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  highlightReqId?: string | null;
  setHighlightReqId?: (reqId: string | null) => void;
};

function matchesRequestQuery(req: AppRequest, query: string): boolean {
  if (!query) return true;
  return [
    req.createdByName,
    req.createdByApt,
    req.visitorName,
    req.carPlate,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
}

export function ConciergeView({ user, activeTab, setActiveTab }: ConciergeViewProps) {
  const requests = useRequests();
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    setQuery('');
  }, [activeTab]);

  const normalizedQuery = useMemo(
    () => debouncedQuery.trim().toLowerCase(),
    [debouncedQuery],
  );

  const matchQuery = useCallback(
    (req: AppRequest) => matchesRequestQuery(req, normalizedQuery),
    [normalizedQuery],
  );

  const allPasses = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isPassRequest), 'all').filter(matchQuery)) as AppRequest[],
    [requests, matchQuery],
  );
  const allTech = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isTechRequest), 'all').filter(matchQuery)) as AppRequest[],
    [requests, matchQuery],
  );

  const passesEmptyCopy = getViewStateCopy('security_passes', 'empty');
  const techEmptyCopy = getViewStateCopy('security_tech', 'empty');

  const passIcons: Array<{ key: string; iconName: string; label: string }> = [
    { key: 'guest', iconName: 'users', label: 'Гость' },
    { key: 'courier', iconName: 'courier', label: 'Курьер' },
    { key: 'taxi', iconName: 'taxi', label: 'Такси' },
    { key: 'car', iconName: 'car', label: 'Авто' },
    { key: 'master', iconName: 'tools', label: 'Мастер' },
  ];

  return (
    <>
      {activeTab === 'passes' && (
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
              title={debouncedQuery ? 'Ничего не найдено' : passesEmptyCopy.title}
              subtitle={debouncedQuery ? 'Попробуйте другой запрос' : passesEmptyCopy.subtitle}
            />
          )}
        </>
      )}

      {activeTab === 'tech' && (
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
              title={debouncedQuery ? 'Ничего не найдено' : techEmptyCopy.title}
              subtitle={debouncedQuery ? 'Попробуйте другой запрос' : techEmptyCopy.subtitle}
            />
          )}
        </>
      )}

      {activeTab === 'templates' && <MyTemplates user={user} onUse={(template: Template) => setModal({ type: template.type as RequestType, cat: template.category, data: template as unknown as Record<string, unknown> })} />}
      {activeTab === 'residents' && <ResidentsView user={user} />}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'chat' && <ChatView user={user} />}
      {modal && (
        <CreateModal
          user={user}
          type={modal.type}
          initialCat={modal.cat}
          initialData={modal.data}
          onClose={() => setModal(null)}
          onDone={() => {}}
        />
      )}
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}

export function SecurityView({ user, activeTab, setActiveTab, highlightReqId, setHighlightReqId }: SecurityViewProps) {
  return (
    <>
      {activeTab === 'passes' && (
        <SecurityPassesPane
          user={user}
          highlightReqId={highlightReqId}
          setHighlightReqId={setHighlightReqId}
        />
      )}
      {activeTab === 'perms' && <SecurityPermsList />}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'guardpost' && (
        <GuardPostMode
          user={user}
          onViewDetails={(reqId) => {
            setActiveTab('passes');
            setHighlightReqId?.(reqId);
          }}
        />
      )}
      {activeTab === 'residents' && <ResidentsView user={user} />}
      {activeTab === 'chat' && <ChatView user={user} />}
    </>
  );
}
