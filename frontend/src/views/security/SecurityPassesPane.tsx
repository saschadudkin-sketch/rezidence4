import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRequests } from '../../store/AppStore';
import type { AppUser } from '../../store/slices/usersSlice';
import type { RequestStatus, RequestType, AppRequest } from '../../store/slices/requestsSlice';
import { useDebounce } from '../../hooks/useDebounce';
import { useUrlSearchParams } from '../../hooks/useUrlSearchParams';
import { sortReqs, filterByPeriod } from '../../utils';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import PageActionBar from '../../ui/PageActionBar';
import { ScanQRModal } from '../../requests/ScanQRModal';
import { CarSearchModal } from '../../requests/CarSearchModal';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { isSecurityActionablePass } from '../../domain/passLifecycle';

type SecurityPassesPaneProps = {
  user: Pick<AppUser, 'uid' | 'name' | 'role'>;
  highlightReqId?: string | null;
  setHighlightReqId?: (reqId: string | null) => void;
};

const SECURITY_FILTER_KEYS = ['securityRole', 'securityType', 'securityStatus', 'securityPeriod', 'securityQ'] as const;

function matchesSecurityQuery(req: AppRequest, query: string): boolean {
  if (!query) return true;
  return [
    req.createdByName,
    req.createdByApt,
    req.visitorName,
    req.carPlate,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
}

export function SecurityPassesPane({ user, highlightReqId, setHighlightReqId }: SecurityPassesPaneProps) {
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [showCarSearch, setShowCarSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const requests = useRequests();
  const filter = searchParams.get('securityRole') || 'all';
  const typeFilter = (searchParams.get('securityType') || 'all') as 'all' | RequestType;
  const statusFilter = (searchParams.get('securityStatus') || 'all') as 'all' | RequestStatus;
  const datePeriod = searchParams.get('securityPeriod') || 'all';
  const query = searchParams.get('securityQ') || '';
  const debouncedQuery = useDebounce(query, 250);

  const updateSecurityFilters = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const pendingPassCount = useMemo(
    () => requests.filter(isSecurityActionablePass).length,
    [requests],
  );

  useEffect(() => {
    if (!highlightReqId) return;
    if (!SECURITY_FILTER_KEYS.some((key) => searchParams.has(key))) return;

    const next = new URLSearchParams(searchParams);
    SECURITY_FILTER_KEYS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [highlightReqId, searchParams, setSearchParams]);

  const pendingTechCount = useMemo(
    () => requests.filter((req) => req.type === 'tech' && req.status === 'pending').length,
    [requests],
  );
  const requestsEmptyCopy = getViewStateCopy('requests', 'empty');
  const activeFilterCount = [
    Boolean(query),
    datePeriod !== 'all',
    typeFilter !== 'all',
    statusFilter !== 'all',
    filter !== 'all',
  ].filter(Boolean).length;

  const shown = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    return sortReqs(
      filterByPeriod(requests, datePeriod)
        .filter((req) => typeFilter === 'all' || req.type === typeFilter)
        .filter((req) => statusFilter === 'all' || req.status === statusFilter)
        .filter((req) => filter === 'all' || req.createdByRole === filter)
        .filter((req) => matchesSecurityQuery(req, normalizedQuery)),
    ) as AppRequest[];
  }, [requests, datePeriod, debouncedQuery, typeFilter, statusFilter, filter]);

  const datePills: Array<[string, string]> = [
    ['today', 'Сегодня'],
    ['week', 'Неделя'],
    ['all', 'Все'],
  ];

  return (
    <>
      <PageActionBar
        className="security-action-btns"
        primaryLabel="Сканировать QR"
        onPrimary={() => setShowScan(true)}
        secondary={[
          { label: 'Авто', onClick: () => setShowCarSearch(true) },
        ]}
      />
      <div className="sec-filters-toggle-row">
        <button
          type="button"
          className={`btn-outline sec-filters-toggle${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
        >
          <span className="u-inline-icon"><AppIcon name="filter" size={14} /></span>
          <span>Фильтры</span>
          {activeFilterCount > 0 && <span className="tab-pending-badge">{activeFilterCount}</span>}
        </button>
      </div>
      <div className="search-wrap u-search-sm sec-filters-search">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          aria-label="Поиск по имени, квартире, авто или комментарию"
          placeholder="Имя, квартира, авто, комментарий"
          value={query}
          onChange={(event) => updateSecurityFilters({ securityQ: event.target.value.trim() || null })}
        />
      </div>
      {showFilters && (
        <div className="sec-filters">
          <section className="sec-filter-group">
            <div className="sec-filter-group-title">Период</div>
            <div className="sec-filters-row sec-filters-row--scroll">
              {datePills.map(([key, label]) => (
                <button key={key} className={`date-pill ${datePeriod === key ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityPeriod: key })}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="sec-filter-group">
            <div className="sec-filter-group-title">Тип</div>
            <div className="sec-filters-row sec-filters-row--scroll">
              {([
                ['all', 'Все типы', 0],
                ['pass', 'Пропуска', pendingPassCount],
                ['tech', 'Техслужба', pendingTechCount],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  className={`date-pill ${typeFilter === key ? 'active' : ''}${count > 0 && key !== 'all' ? ' has-pending' : ''}`}
                  onClick={() => updateSecurityFilters({ securityType: key })}
                >
                  {label}
                  {count > 0 && key !== 'all' ? <span className="tab-pending-badge">{count}</span> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="sec-filter-group">
            <div className="sec-filter-group-title">Статус</div>
            <div className="sec-filters-grid sec-filters-grid--status">
              {([
                ['all', 'Все статусы'],
                ['pending', 'В ожидании'],
                ['approved', 'Одобрены'],
                ['rejected', 'Отклонены'],
                ['arrived', 'Вошли'],
                ['expired', 'Истёкшие'],
              ] as const).map(([key, label]) => (
                <button key={key} className={`date-pill sm ${statusFilter === key ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityStatus: key })}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          {typeFilter !== 'tech' && (
            <section className="sec-filter-group">
              <div className="sec-filter-group-title">Роль</div>
              <div className="sec-filters-grid sec-filters-grid--roles">
                {([
                  ['all', 'Все роли'],
                  ['owner', 'Собственники'],
                  ['tenant', 'Арендаторы'],
                  ['contractor', 'Подрядчики'],
                ] as const).map(([key, label]) => (
                  <button key={key} className={`date-pill sm ${filter === key ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityRole: key })}>
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <StateBlock
          type="empty"
          title={query ? 'Ничего не найдено' : requestsEmptyCopy.title}
          subtitle={query ? 'Попробуйте другой запрос' : requestsEmptyCopy.subtitle}
        />
      ) : (
        <OperationalRequestList
          items={shown}
          userRole={user.role}
          userName={user.name}
          userId={user.uid}
          highlightId={highlightReqId}
          onHighlighted={() => setHighlightReqId?.(null)}
          className="req-list req-list--compact"
        />
      )}
      {showCarSearch && <CarSearchModal onClose={() => setShowCarSearch(false)} />}
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}
