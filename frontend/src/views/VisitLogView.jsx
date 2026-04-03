/**
 * VisitLogView.jsx — журнал посещений.
 * Карточки с полной информацией о визите.
 */

import { useState, useMemo, memo, useDeferredValue } from 'react';
import { useRequests } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce';
import { CAT_ICON, CAT_LABEL, PASS_DURATION_LABEL, PASS_DURATION_ICON, ROLE_LABELS } from '../constants/index.js';
import { getValidationReasonLabel } from '../constants/statusPresentation';
import { isResident, canManageRequests } from '../domain/permissions';
import { fmtTime } from '../utils.js';
import { useVisitLogs, useClearVisitLogs } from '../hooks/useVisitLogs';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';

function fmtDateFull(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  if (day.getTime() === today.getTime()) return 'Сегодня';
  if (day.getTime() === yesterday.getTime()) return 'Вчера';
  const sameYear = dt.getFullYear() === now.getFullYear();
  return dt.toLocaleDateString('ru-RU', sameYear
    ? { day: 'numeric', month: 'long', weekday: 'short' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDuration(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}ч ${m}мин` : `${h}ч`;
}

function groupByDate(items) {
  const map = {};
  for (const item of items) {
    const key = fmtDateFull(item.arrivedAt || item.createdAt);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return Object.entries(map).map(([label, items]) => ({ label, items }));
}

// FIX [AUDIT-3]: memo — VisitCard рендерится для каждой записи журнала.
// Без memo при изменении фильтра period/decision/query все карточки перерисовывались
// даже если конкретная запись не изменилась.
const VisitCard = memo(function VisitCard({ r }) {
  const duration = fmtDuration(r.createdAt, r.arrivedAt);

  return (
    <div className="vlog-card">
      <div className="vlog-card-left">
        <div className="vlog-card-time">{fmtTime(r.arrivedAt || r.createdAt)}</div>
        <div className="vlog-card-icon"><AppIcon name={CAT_ICON[r.category] || 'users'} /></div>
      </div>
      <div className="vlog-card-body">
        <div className="vlog-card-row1">
          <span className="vlog-card-name">{r.visitorName || CAT_LABEL[r.category]}</span>
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
          <span className="vlog-tag cat">{CAT_LABEL[r.category]}</span>
          {r.result === 'allowed' && <span className="vlog-tag ok"><AppIcon name="check" className="u-inline-icon" /> Допуск</span>}
          {r.result === 'denied' && <span className="vlog-tag bad"><AppIcon name="denied" className="u-inline-icon" /> Отказ</span>}
          {r.carPlate && <span className="vlog-tag car"><AppIcon name="car" className="u-inline-icon" /> {r.carPlate}</span>}
          {duration && <span className="vlog-tag dur"><AppIcon name="history" className="u-inline-icon" /> {duration}</span>}
          {r.status === 'expired' && <span className="vlog-tag expired">Истёк</span>}
        </div>
        {r.actorName && (
          <div className="vlog-card-comment">
            Решение: {r.actorName}{r.actorRole ? ` (${ROLE_LABELS[r.actorRole] || r.actorRole})` : ''}
          </div>
        )}
        {r.comment && <div className="vlog-card-comment">{r.comment}</div>}
      </div>
    </div>
  );
});

export default function VisitLogView({ user }) {
  const requests = useRequests();
  // A-10: useQuery replaces manual useState/useEffect/useCallback loading pattern
  const { data: visitEvents = [], isLoading, isError } = useVisitLogs();
  const clearLogs = useClearVisitLogs();
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [decision, setDecision] = useState('all');
  // FIX [AUDIT-3]: confirmClear заменяет window.confirm() — нативный confirm блокирует
  // UI thread и не стилизуется. Вместо него — inline-кнопка подтверждения.
  const [confirmClear, setConfirmClear] = useState(false);
  // A-15: useDeferredValue defers filter recomputation so that typing stays
  // responsive even when the visits list is large.
  const debouncedQuery = useDebounce(query, 150);
  const deferredQuery  = useDeferredValue(debouncedQuery);
  const q = deferredQuery.trim().toLowerCase();
  const canClearLogs = user.role === 'admin';  // FIX [AUDIT-5 #10]: admin can clear in both modes
  const canExport = canManageRequests(user.role); // FIX: CSV export was hidden in live mode

  const visits = useMemo(() => {
    const requestsById = new Map(requests.map((r) => [r.id, r]));
    let arr = (visitEvents || []).map((event) => {
      const baseReq = event.requestSnapshot || requestsById.get(event.requestId) || {};
      const timestamp = event.timestamp || baseReq.arrivedAt || baseReq.createdAt || new Date().toISOString();
      return {
        id: event.id || event.requestId || `${timestamp}_${event.result}`,
        requestId: event.requestId || baseReq.id || null,
        category: event.category || baseReq.category || 'guest',
        visitorName: event.visitorName || baseReq.visitorName || null,
        carPlate: event.carPlate || baseReq.carPlate || null,
        createdByUid: event.createdByUid || baseReq.createdByUid || null,
        createdByName: event.createdByName || baseReq.createdByName || '—',
        createdByApt: event.createdByApt || baseReq.createdByApt || '—',
        passDuration: event.passDuration || baseReq.passDuration || null,
        createdAt: baseReq.createdAt || timestamp,
        arrivedAt: timestamp,
        status: event.result === 'denied' ? 'rejected' : 'arrived',
        result: event.result || null,
        actorName: event.actorName || null,
        actorRole: event.actorRole || null,
        comment: event.reason ? `Проверка QR: ${getValidationReasonLabel(event.reason)}` : '',
      };
    });
    if (isResident(user.role)) arr = arr.filter(r => r.createdByUid === user.uid);
    if (period !== 'all') {
      const ms = period === 'today' ? 86_400_000 : period === 'week' ? 7 * 86_400_000 : 30 * 86_400_000;
      arr = arr.filter(r => Date.now() - new Date(r.arrivedAt).getTime() < ms);
    }
    if (decision !== 'all') {
      arr = arr.filter(r => r.result === decision);
    }
    if (q) {
      arr = arr.filter(r =>
        (r.visitorName || '').toLowerCase().includes(q)
        || (r.carPlate || '').toLowerCase().includes(q)
        || (r.createdByName || '').toLowerCase().includes(q)
        || (r.createdByApt || '').includes(q)
        || (r.comment || '').toLowerCase().includes(q)
      );
    }
    // FIX [PERF]: pre-compute timestamps — new Date() в компараторе = O(n log n) аллокаций
    const withTs = arr.map(r => ({ r, ts: new Date(r.arrivedAt || r.createdAt).getTime() }));
    withTs.sort((a, b) => b.ts - a.ts);
    return withTs.map(({ r }) => r);
  // FIX [PERF]: заменили [user] на [user.role, user.uid] — объект user стабилен как prop,
  // но явные примитивные deps помогают линтеру и документируют реальные зависимости
  }, [requests, visitEvents, user.role, user.uid, period, decision, q]);

  const handleClearLogs = async () => {
    // FIX [AUDIT-3]: window.confirm заменён на двухшаговое подтверждение
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    try { await clearLogs(); } catch(e) { /* ignore */ }
  };

  const handleExportCsv = () => {
    const header = ['Дата', 'Тип', 'Посетитель', 'Квартира', 'Резидент', 'Решение', 'Кто принял', 'Причина'];
    const rows = visits.map((v) => ([
      new Date(v.arrivedAt || v.createdAt).toLocaleString('ru-RU'),
      CAT_LABEL[v.category] || v.category,
      v.visitorName || '',
      v.createdByApt || '',
      v.createdByName || '',
      v.result === 'denied' ? 'Отказ' : 'Допуск',
      v.actorName ? `${v.actorName}${v.actorRole ? ` (${ROLE_LABELS[v.actorRole] || v.actorRole})` : ''}` : '',
      v.comment || '',
    ]));
    const csv = [header, ...rows]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `visit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // FIX [MEMORY]: задержка перед revoke — браузер должен успеть начать загрузку
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // FIX [AUDIT-5]: groupByDate вызывался при каждом рендере (изменение confirmClear,
  // loadLogs, любого state). visits уже мемоизирован, поэтому groups тоже должен быть.
  const groups = useMemo(() => groupByDate(visits), [visits]);
  const totalCount = visits.length;

  return (
    <div className="vlog-wrap">
      {/* Phase-1: unified loading/empty state block */}
      {isLoading && (
        <StateBlock
          type="loading"
          title="Загрузка журнала..."
          subtitle="Пожалуйста, подождите"
        />
      )}
      {isError && !isLoading && (
        <StateBlock
          type="error"
          title="Не удалось загрузить журнал"
          subtitle="Проверьте соединение и попробуйте снова"
        />
      )}
      {!isLoading && !isError && (
      <>
      <div className="vlog-header">
        <span className="vlog-title"><AppIcon name="history" className="u-inline-icon" /> Журнал посещений</span>
        <div className="u-row-g8">
          <span className="vlog-total">{totalCount} {totalCount === 1 ? 'визит' : totalCount < 5 ? 'визита' : 'визитов'}</span>
          {canExport && (
            <button className="btn-outline btn-hdr" onClick={handleExportCsv}>
              Экспорт CSV
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

      <div className="date-pills date-pills-row">
        {[['today','Сегодня'],['week','Неделя'],['month','Месяц'],['all','Всё время']].map(([k, l]) => (
          <button key={k} className={'date-pill' + (period === k ? ' active' : '')} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>

      <div className="date-pills date-pills-row">
        {[
          ['all', null, 'Все решения'],
          ['allowed', 'check', 'Допущены'],
          ['denied', 'denied', 'Отказы'],
        ].map(([k, iconName, l]) => (
          <button key={k} className={'date-pill' + (decision === k ? ' active' : '')} onClick={() => setDecision(k)}>
            {iconName ? <AppIcon name={iconName} className="u-inline-icon" /> : null}
            {l}
          </button>
        ))}
      </div>

      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" /></span>
        <input className="search-inp" placeholder="Поиск по имени, авто, квартире, комментарию..."
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {visits.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : 'Посещений нет'}
          subtitle={q ? 'Попробуйте другой запрос' : 'Входы посетителей будут отображаться здесь'}
          actionLabel={q ? 'Сбросить поиск' : undefined}
          onAction={q ? () => setQuery('') : undefined}
        />
      )}

      {groups.map(g => (
        <div key={g.label} className="vlog-group">
          <div className="vlog-date-label">{g.label}</div>
          <div className="vlog-cards">
            {g.items.map(r => <VisitCard key={r.id} r={r} />)}
          </div>
        </div>
      ))}
      </>
      )}
    </div>
  );
}
