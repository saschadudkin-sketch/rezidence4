import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRequests, useBlacklist, useUsers } from '../store/AppStore';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import { sortReqs, playAlert } from '../utils';
import { useDebounce } from '../hooks/useDebounce';
import { ScanQRModal } from '../requests/ScanQRModal';
import ErrorBoundary from '../ui/ErrorBoundary';
import { AppIcon } from '../ui/AppIcon';
import { VirtualList } from '../ui/VirtualList';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import GuardCard from './guard/GuardCard';
import GuardSection from './guard/GuardSection';
import TempPassCard from './guard/TempPassCard';
import TechCard from './guard/TechCard';

type GuardPostModeProps = {
  user: Pick<AppUser, 'uid' | 'name' | 'role'>;
  onViewDetails?: (reqId: string) => void;
};

function hasOpenTemporaryWindow(req: AppRequest): req is AppRequest & { validUntil: string | Date } {
  return Boolean(req.passDuration === 'temporary' && req.validUntil);
}

function matchesGuardSearch(req: AppRequest, query: string): boolean {
  if (!query.trim()) return true;
  const normalizedQuery = query.trim().toLowerCase();
  return [
    req.visitorName,
    req.carPlate,
    req.createdByName,
    req.createdByApt,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery));
}

export default function GuardPostMode({ user, onViewDetails }: GuardPostModeProps) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { users } = useUsers();
  const [subTab, setSubTab] = useState<'active' | 'temp' | 'tech'>('active');
  const [showScan, setShowScan] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const securityPassesEmptyCopy = getViewStateCopy('security_passes', 'empty');
  const securityTechEmptyCopy = getViewStateCopy('security_tech', 'empty');
  const debouncedSearch = useDebounce(searchQuery, 250);

  const matchSearch = useCallback(
    (req: AppRequest) => matchesGuardSearch(req, debouncedSearch),
    [debouncedSearch],
  );

  const { approved, temporary, techPending, techActive } = useMemo(() => {
    const approvedRequests: AppRequest[] = [];
    const temporaryRequests: Array<{ req: AppRequest & { validUntil: string | Date }; ts: number }> = [];
    const pendingTechRequests: AppRequest[] = [];
    const activeTechRequests: AppRequest[] = [];

    for (const req of requests) {
      if (req.type === 'pass') {
        const isOpenForSecurity = req.status === 'pending' || req.status === 'approved';

        if (hasOpenTemporaryWindow(req) && (isOpenForSecurity || req.status === 'arrived')) {
          temporaryRequests.push({ req, ts: new Date(req.validUntil).getTime() });
          continue;
        }

        if (isOpenForSecurity && req.passDuration !== 'temporary') {
          approvedRequests.push(req);
        }
        continue;
      }

      if (req.type === 'tech' && (req.status === 'pending' || req.status === 'accepted')) {
        if (req.status === 'pending') pendingTechRequests.push(req);
        activeTechRequests.push(req);
      }
    }

    temporaryRequests.sort((left, right) => left.ts - right.ts);

    return {
      approved: sortReqs(approvedRequests) as AppRequest[],
      temporary: temporaryRequests.map(({ req }) => req),
      techPending: sortReqs(pendingTechRequests) as AppRequest[],
      techActive: sortReqs(activeTechRequests) as AppRequest[],
    };
  }, [requests]);

  const { filteredApproved, filteredTemporary, filteredTechPending, filteredTechAccepted } = useMemo(() => {
    const techPendingCards = techActive.filter((req) => req.status === 'pending');
    const techAcceptedCards = techActive.filter((req) => req.status === 'accepted');

    if (!debouncedSearch.trim()) {
      return {
        filteredApproved: approved,
        filteredTemporary: temporary,
        filteredTechPending: techPendingCards,
        filteredTechAccepted: techAcceptedCards,
      };
    }

    return {
      filteredApproved: approved.filter(matchSearch),
      filteredTemporary: temporary.filter(matchSearch),
      filteredTechPending: techPendingCards.filter(matchSearch),
      filteredTechAccepted: techAcceptedCards.filter(matchSearch),
    };
  }, [approved, temporary, techActive, matchSearch, debouncedSearch]);

  const prevPassCount = useRef(approved.length);
  const prevTechCount = useRef(techPending.length);

  useEffect(() => {
    if (approved.length > prevPassCount.current) playAlert('pass');
    if (techPending.length > prevTechCount.current) playAlert('tech');
    prevPassCount.current = approved.length;
    prevTechCount.current = techPending.length;
  }, [approved.length, techPending.length]);

  const getPhone = useCallback(
    (uid?: string) => {
      if (!uid) return null;
      const resident = users[uid];
      return resident ? resident.phone : null;
    },
    [users],
  );

  return (
    <>
      <div className="guard-post">
        <div className="guard-mode-banner" role="status" aria-label="Активный режим охраны">
          <span className="guard-mode-banner-dot" aria-hidden="true" />
          <span>Режим поста охраны активен</span>
        </div>

        <div className="guard-header">
          <div className="guard-header-stats">
            <div className="guard-stat">
              <span className="guard-stat-val">{approved.length}</span>
              <span className="guard-stat-lbl">к проходу</span>
            </div>
            <div className="guard-stat">
              <span className="guard-stat-val">{temporary.length}</span>
              <span className="guard-stat-lbl">временные</span>
            </div>
            {techActive.length > 0 && (
              <div className={'guard-stat' + (techPending.length > 0 ? ' urgent' : '')}>
                <span className="guard-stat-val">{techActive.length}</span>
                <span className="guard-stat-lbl">техслужба</span>
              </div>
            )}
          </div>
        </div>

        <button className="scan-qr-btn" onClick={() => setShowScan(true)}>
          <span className="u-inline-icon"><AppIcon name="camera" size={18} /></span>
          <span>Сканировать QR-код пропуска</span>
        </button>

        <div className="search-wrap u-mb16">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input
            className="search-inp"
            aria-label="Поиск по имени, авто или апартаментам"
            placeholder="Поиск по имени, авто, апарт.…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Очистить поиск">
              <AppIcon name="close" size={12} />
            </button>
          )}
        </div>

        <div className="guard-subtabs">
          <button className={'guard-subtab' + (subTab === 'active' ? ' active' : '')} onClick={() => setSubTab('active')}>
            <span className="u-inline-icon"><AppIcon name="shield" size={14} /></span> Активные
            {approved.length > 0 && <span className="guard-subtab-badge">{approved.length}</span>}
          </button>
          <button className={'guard-subtab' + (subTab === 'temp' ? ' active' : '')} onClick={() => setSubTab('temp')}>
            <span className="u-inline-icon"><AppIcon name="clock" size={14} /></span> Временные
            {temporary.length > 0 && <span className="guard-subtab-badge">{temporary.length}</span>}
          </button>
          <button
            className={'guard-subtab' + (subTab === 'tech' ? ' active' : '') + (techPending.length > 0 ? ' has-new' : '')}
            onClick={() => setSubTab('tech')}
          >
            <span className="u-inline-icon"><AppIcon name="tools" size={14} /></span> Техслужба
            {techActive.length > 0 && <span className="guard-subtab-badge">{techActive.length}</span>}
          </button>
        </div>

        {subTab === 'active' && (
          <>
            {approved.length === 0 && (
              <StateBlock
                type="empty"
                title={securityPassesEmptyCopy.title}
                subtitle={securityPassesEmptyCopy.subtitle}
              />
            )}
            {approved.length > 0 && filteredApproved.length === 0 && (
              <StateBlock type="empty" title="Ничего не найдено" subtitle="Попробуйте другой запрос" />
            )}
            <GuardSection title="Допущены" icon={<AppIcon name="check" size={14} />} count={filteredApproved.length}>
              <VirtualList
                items={filteredApproved}
                estimateSize={148}
                renderItem={(req) => (
                  <ErrorBoundary key={req.id} name={`Карточка ${req.id}`}>
                    <GuardCard
                      req={req}
                      userName={user.name}
                      blacklist={blacklist}
                      residentPhone={getPhone(req.createdByUid)}
                      onViewDetails={onViewDetails}
                    />
                  </ErrorBoundary>
                )}
              />
            </GuardSection>
          </>
        )}

        {subTab === 'temp' && (
          <>
            {temporary.length === 0 && (
              <StateBlock
                type="empty"
                title="Нет временных пропусков"
                subtitle="Временные пропуска с открытым доступом появятся здесь"
              />
            )}
            {temporary.length > 0 && filteredTemporary.length === 0 && (
              <StateBlock type="empty" title="Ничего не найдено" subtitle="Попробуйте другой запрос" />
            )}
            <div className="guard-list">
              {filteredTemporary.map((req) => (
                <ErrorBoundary key={req.id} name={`Временный пропуск ${req.id}`}>
                  <TempPassCard
                    req={req}
                    userName={user.name}
                    blacklist={blacklist}
                    residentPhone={getPhone(req.createdByUid)}
                  />
                </ErrorBoundary>
              ))}
            </div>
          </>
        )}

        {subTab === 'tech' && (
          <>
            {techActive.length === 0 && (
              <StateBlock
                type="empty"
                title={securityTechEmptyCopy.title}
                subtitle={securityTechEmptyCopy.subtitle}
              />
            )}
            {techActive.length > 0 && filteredTechPending.length === 0 && filteredTechAccepted.length === 0 && (
              <StateBlock type="empty" title="Ничего не найдено" subtitle="Попробуйте другой запрос" />
            )}
            <GuardSection title="Новые заявки" icon={<AppIcon name="hourglass" size={14} />} count={filteredTechPending.length}>
              {filteredTechPending.map((req) => (
                <ErrorBoundary key={req.id} name={`Техзаявка ${req.id}`}>
                  <TechCard req={req} userName={user.name} residentPhone={getPhone(req.createdByUid)} />
                </ErrorBoundary>
              ))}
            </GuardSection>
            <GuardSection title="В работе" icon={<AppIcon name="tools" size={14} />} count={filteredTechAccepted.length}>
              {filteredTechAccepted.map((req) => (
                <ErrorBoundary key={req.id} name={`Техзаявка ${req.id}`}>
                  <TechCard req={req} userName={user.name} residentPhone={getPhone(req.createdByUid)} />
                </ErrorBoundary>
              ))}
            </GuardSection>
          </>
        )}
      </div>
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}
