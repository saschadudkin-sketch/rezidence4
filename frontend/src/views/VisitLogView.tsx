import { useState, useMemo, memo, useDeferredValue, useRef } from 'react';
import { useAppStoreSelector } from '../store/AppStore';
import { useDebounce } from '../hooks/useDebounce';
import { CAT_ICON, CAT_LABEL, PASS_DURATION_LABEL, PASS_DURATION_ICON, ROLE_LABELS } from '../constants/index';
import { canManageRequests } from '../domain/permissions';
import { fmtTime } from '../utils';
import { useVisitLogs, useClearVisitLogs } from '../hooks/useVisitLogs';
import { toast } from '../ui/Toasts';
import { presentError } from '../ui/errorPresenter';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import { makeSelectVisitLogCollections } from '../store/selectors/requestsSelectors';
import type { DecisionFilter, PeriodFilter, VisitLogSelectorRow } from '../store/selectors/requestsSelectors';
import type { AppRequest, PassDuration, RequestStatus, RequestType } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { VisitLogPage } from '../services/http/visitLogs';

type VisitLogRow = VisitLogSelectorRow & {
  type: RequestType;
  status: RequestStatus;
  createdAt: string | Date;
  passDuration?: PassDuration | null;
  requestSnapshot?: Partial<AppRequest>;
};
type CategoryKey = keyof typeof CAT_LABEL;
type RoleKey = keyof typeof ROLE_LABELS;

function getCategoryLabel(category?: string): string {
  return category && category in CAT_LABEL ? CAT_LABEL[category as CategoryKey] : category ?? 'Пропуск';
}

function getCategoryIcon(category?: string): string {
  return category && category in CAT_ICON ? CAT_ICON[category as CategoryKey] : 'users';
}

function getRoleLabel(role?: string | null): string | null {
  if (!role) return null;
  return role in ROLE_LABELS ? ROLE_LABELS[role as RoleKey] : role;
}

function normalizeDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function fmtDuration(from?: string | Date | null, to?: string | Date | null): string | null {
  if (!from || !to) return null;
  const ms = normalizeDate(to).getTime() - normalizeDate(from).getTime();
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return minutes ? `${hours}ч ${minutes}мин` : `${hours}ч`;
}

const VisitCard = memo(function VisitCard({ r }: { r: VisitLogRow }) {
  const duration = fmtDuration(r.createdAt, r.arrivedAt);
  const actorRoleLabel = getRoleLabel(r.actorRole);

  return (
    <div className="vlog-card">
      <div className="vlog-card-left">
        <div className="vlog-card-time">{fmtTime(r.arrivedAt || r.createdAt)}</div>
        <div className="vlog-card-icon"><AppIcon name={getCategoryIcon(r.category)} /></div>
      </div>
      <div className="vlog-card-body">
        <div className="vlog-card-row1">
          <span className="vlog-card-name">{r.visitorName || getCategoryLabel(r.category)}</span>
          {r.passDuration && r.passDuration !== 'once' && (
            <span className={'pass-dur-tag ' + r.passDuration}>
              <AppIcon name={PASS_DURATION_ICON[r.passDuration] || 'ticket'} className="u-inline-icon" /> {PASS_DURATION_LABEL[r.passDuration]}
            </span>
          )}
        </div>
        <div className="vlog-card-details">
          {r.createdByApt && r.createdByApt !== '—' && (
            <span className="vlog-card-apt">Апарт. {r.createdByApt}</span>
          )}
          <span className="vlog-card-who">{r.createdByName}</span>
        </div>
        <div className="vlog-card-tags">
          <span className="vlog-tag cat">{getCategoryLabel(r.category)}</span>
          {r.result === 'allowed' && <span className="vlog-tag ok"><AppIcon name="check" className="u-inline-icon" /> Допуск</span>}
          {r.result === 'denied' && <span className="vlog-tag bad"><AppIcon name="denied" className="u-inline-icon" /> Отказ</span>}
          {r.carPlate && <span className="vlog-tag car"><AppIcon name="car" className="u-inline-icon" /> {r.carPlate}</span>}
          {duration && <span className="vlog-tag dur"><AppIcon name="clock" className="u-inline-icon" /> {duration}</span>}
          {r.status === 'expired' && <span className="vlog-tag expired">Истёк</span>}
        </div>
        {r.actorName && (
          <div className="vlog-card-comment">
            Решение: {r.actorName}{actorRoleLabel ? ` (${actorRoleLabel})` : ''}
          </div>
        )}
        {r.comment && <div className="vlog-card-comment">{r.comment}</div>}
      </div>
    </div>
  );
});

export default function VisitLogView({ user }: { user: AppUser }) {
  const { data: visitLogsPage, isLoading, isError } = useVisitLogs() as {
    data?: VisitLogPage<VisitLogRow>;
    isLoading: boolean;
    isError: boolean;
  };
  const visitEvents = useMemo(() => visitLogsPage?.data ?? [], [visitLogsPage]);
  const clearLogs = useClearVisitLogs();
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const visitCollectionsSelectorRef = useRef(makeSelectVisitLogCollections());
  const debouncedQuery = useDebounce(query, 150);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const q = deferredQuery.trim().toLowerCase();
  const canClearLogs = user.role === 'admin';
  const canExport = canManageRequests(user.role);
  const { visits, groups } = useAppStoreSelector((state) =>
    visitCollectionsSelectorRef.current(state, visitEvents, user.role, user.uid, period, decision, q));

  const handleClearLogs = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    try {
      await clearLogs();
    } catch (error) {
      toast(presentError(error, 'visitlog.clear').message, 'error');
    }
  };

  const handleExportCsv = () => {
    const header = ['Дата', 'Тип', 'Посетитель', 'Квартира', 'Резидент', 'Решение', 'Кто принял', 'Причина'];
    const rows = visits.map((visit) => ([
      normalizeDate(visit.arrivedAt || visit.createdAt).toLocaleString('ru-RU'),
      getCategoryLabel(visit.category),
      visit.visitorName || '',
      visit.createdByApt || '',
      visit.createdByName || '',
      visit.result === 'denied' ? 'Отказ' : 'Допуск',
      visit.actorName ? `${visit.actorName}${visit.actorRole ? ` (${getRoleLabel(visit.actorRole)})` : ''}` : '',
      visit.comment || '',
    ]));
    const csv = [header, ...rows]
      .map((cols) => cols.map((col) => `"${String(col).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `visit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const totalCount = visitLogsPage?.total ?? visits.length;
  const activeFilterCount = Number(period !== 'all') + Number(decision !== 'all');
  const loadingCopy = getViewStateCopy('visitlog', 'loading');
  const errorCopy = getViewStateCopy('visitlog', 'error');
  const emptyCopy = getViewStateCopy('visitlog', 'empty');

  return (
    <div className="vlog-wrap">
      {isLoading && (
        <StateBlock
          type="loading"
          title={loadingCopy.title}
          subtitle={loadingCopy.subtitle}
        />
      )}
      {isError && !isLoading && (
        <StateBlock
          type="error"
          title={errorCopy.title}
          subtitle={errorCopy.subtitle}
        />
      )}
      {!isLoading && !isError && (
        <>
          <div className="vlog-header">
            <span className="vlog-title"><AppIcon name="history" className="u-inline-icon" /> Журнал</span>
            <div className="vlog-actions">
              <span className="vlog-total vlog-total-badge">{totalCount} {totalCount === 1 ? 'визит' : totalCount < 5 ? 'визита' : 'визитов'}</span>
              {canExport && (
                <button className="btn-outline btn-hdr vlog-export-btn" onClick={handleExportCsv}>
                  <span className="vlog-export-full">Экспорт CSV</span>
                  <span className="vlog-export-short">CSV</span>
                </button>
              )}
              {canClearLogs && !confirmClear && (
                <button className="btn-outline btn-hdr" onClick={handleClearLogs}>
                  Очистить журнал
                </button>
              )}
              {canClearLogs && confirmClear && (
                <span className="inline-confirm">
                  <span className="inline-confirm__label">Точно?</span>
                  <button className="btn-del-sm btn-hdr" onClick={handleClearLogs}>Да</button>
                  <button className="btn-outline btn-hdr" onClick={() => setConfirmClear(false)}>Нет</button>
                </span>
              )}
            </div>
          </div>

          <div className="sec-filters-toggle-row">
            <button
              type="button"
              className={`btn-outline sec-filters-toggle${showFilters ? ' active' : ''}`}
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
            >
              <AppIcon name="filters" className="u-inline-icon" />
              Фильтры
              {activeFilterCount > 0 && <span className="tab-pending-badge">{activeFilterCount}</span>}
            </button>
          </div>

          {showFilters && (
            <div className="sec-filters vlog-filters">
              <div className="sec-filter-group">
                <div className="sec-filter-group-title">Период</div>
                <div className="sec-filters-row sec-filters-row--scroll">
                  {([
                    ['today', 'Сегодня'],
                    ['week', 'Неделя'],
                    ['month', 'Месяц'],
                    ['all', 'Всё время'],
                  ] as const).map(([key, label]) => (
                    <button key={key} className={'date-pill' + (period === key ? ' active' : '')} onClick={() => setPeriod(key)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sec-filter-group">
                <div className="sec-filter-group-title">Решение</div>
                <div className="sec-filters-row sec-filters-row--scroll">
                  {([
                    ['all', null, 'Все решения'],
                    ['allowed', 'check', 'Допущены'],
                    ['denied', 'denied', 'Отказы'],
                  ] as const).map(([key, iconName, label]) => (
                    <button key={key} className={'date-pill' + (decision === key ? ' active' : '')} onClick={() => setDecision(key)}>
                      {iconName ? <AppIcon name={iconName} className="u-inline-icon" /> : null}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="search-wrap u-mb16">
            <span className="search-ico"><AppIcon name="search" /></span>
            <input
              className="search-inp"
              placeholder="Поиск по имени, авто, квартире"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {visits.length === 0 && (
            <StateBlock
              type="empty"
              title={q ? 'Ничего не найдено' : emptyCopy.title}
              subtitle={q ? 'Попробуйте другой запрос' : emptyCopy.subtitle}
              actionLabel={q ? 'Сбросить поиск' : undefined}
              onAction={q ? () => setQuery('') : undefined}
            />
          )}

          {groups.map((group) => (
            <div key={group.label} className="vlog-group">
              <div className="vlog-date-label">{group.label}</div>
              <div className="vlog-cards">
                {group.items.map((row) => <VisitCard key={row.id} r={row} />)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
