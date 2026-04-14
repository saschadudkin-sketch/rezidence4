import { useState, useMemo, memo, useDeferredValue, useRef } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { useAppStoreSelector, useUsers } from '../store/AppStore';
import { ROLES } from '../domain/permissions';
import { ROLE_LABELS, ROLE_COLOR } from '../constants';
import { filterByPeriod } from '../utils';
import { AddUserModal } from '../ui/Modals';
import AdminUserRow   from './admin/AdminUserRow';
import AdminReqRow    from './admin/AdminReqRow';
import AdminPermsView from './admin/AdminPermsView';
import VisitLogView  from './VisitLogView';
import BlacklistView from './BlacklistView';
import ResidentsView from './ResidentsView';
import { ChatView }  from '../chat/ChatView';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import SectionHeader from '../ui/SectionHeader';
import { VirtualList } from '../ui/VirtualList';
import PageActionBar from '../ui/PageActionBar';
import { getViewStateCopy } from '../ui/viewStateContract';
import { useTelemetrySla } from '../hooks/useTelemetrySla';
import SlaDashboard from '../ui/SlaDashboard';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { AppIconName } from '../ui/AppIcon';
import { makeSelectAdminCollections } from '../store/selectors/requestsSelectors';

// ─── AdminStatsView ───────────────────────────────────────────────────────────

// UI-06: skeleton placeholder for 6 stat tiles
function StatCardSkeleton() {
  return (
    <div className="stat-card stat-card--skeleton" aria-hidden="true">
      <div className="stat-ico-skel" />
      <div className="stat-val-skel" />
      <div className="stat-lbl-skel" />
    </div>
  );
}

// FIX [PERF]: memo — не ре-рендерится при смене activeTab если allUsers/requests не изменились
const AdminStatsView = memo(function AdminStatsView({ allUsers, requests, isLoading }: { allUsers: AppUser[]; requests: AppRequest[]; isLoading: boolean }) {
  const sla = useTelemetrySla();
  // FIX [PERF]: stats и roleCount мемоизированы — не пересчитываются при несвязанных ре-рендерах
  const { stats, roleCount } = useMemo(() => {
    // FIX [PERF]: todayTs — числовая метка, не объект Date — избегаем new Date() в каждом filter
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const todayTs = now.getTime();
    const todayR = requests.filter(r => new Date(r.createdAt).getTime() >= todayTs);
    return {
      stats: [
        ['users', allUsers.length,                                         'Пользователей'],
        ['tools', allUsers.filter(u => u.role === ROLES.CONTRACTOR).length, 'Подрядчиков'],
        ['ticket', todayR.filter(r => r.type === 'pass').length,            'Пропусков сегодня'],
        ['tools', todayR.filter(r => r.type === 'tech').length,             'Техзаявок сегодня'],
        ['history', requests.filter(r => r.status === 'pending').length,    'Ожидают решения'],
        ['check', requests.filter(r => r.status === 'arrived').length,       'Входов отмечено'],
      ] satisfies ReadonlyArray<readonly [AppIconName, number, string]>,
      roleCount: allUsers.reduce<Record<string, number>>((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {}),
    } satisfies { stats: ReadonlyArray<readonly [AppIconName, number, string]>; roleCount: Record<string, number> };
  }, [allUsers, requests]);

  if (isLoading) {
    return (
      <div className="stats-grid" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <div className="stats-grid">
        {stats.map(([icon, val, lbl]) => (
          <div key={lbl} className="stat-card">
            <span className="stat-ico"><AppIcon name={icon} size={18} /></span>
            <div className={val === 0 ? 'stat-val zero' : 'stat-val'}>{val}</div>
            <div className="stat-lbl">{lbl}</div>
            <div className="stat-card-accent" />
          </div>
        ))}
      </div>
      <SlaDashboard snapshot={sla} />
      <SectionHeader title="Распределение по ролям" />
      <div className="t-wrap">
        {Object.entries(roleCount).map(([role, count]) => {
          const pct = Math.round((count as number) / allUsers.length * 100);
          const roleKey = role as keyof typeof ROLE_LABELS;
          return (
            <div key={role} className="u-pad12-16 role-stat-row">
              <div className="u-flex-between u-mb8">
                <span className="u-fs13 u-t1 u-flex-center u-gap8">
                  <span className={`u-role-dot ${ROLE_COLOR[roleKey] ? roleKey : 'default'}`} />
                  {ROLE_LABELS[roleKey]}
                </span>
                <span className="admin-role-value">{count}</span>
              </div>
              <progress className="admin-role-progress" max={100} value={pct} />
            </div>
          );
        })}
      </div>
    </>
  );
});

// ─── AdminUsersView ───────────────────────────────────────────────────────────

// FIX [PERF]: memo — не ре-рендерится при переключении других вкладок
const AdminUsersView = memo(function AdminUsersView({ allUsers, currentUser, contractorOnly = false }: { allUsers: AppUser[]; currentUser: AppUser; contractorOnly?: boolean }) {
  const [addModal,   setAddModal]   = useState(false);
  const [query,      setQuery]      = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  // A-15: deferred query keeps typing responsive while filtering large user lists
  const debouncedQuery = useDebounce(query, 150);
  const deferredQuery  = useDeferredValue(debouncedQuery);
  const q = deferredQuery.trim().toLowerCase();

  const filtered = useMemo(() => allUsers.filter(u => {
    const matchQ = !q || u.name.toLowerCase().includes(q) || u.phone.includes(q) || (u.apartment && u.apartment.toLowerCase().includes(q));
    const matchR = contractorOnly ? u.role === ROLES.CONTRACTOR : (roleFilter === 'all' || u.role === roleFilter);
    return matchQ && matchR;
  }), [allUsers, q, roleFilter, contractorOnly]);

  const ROLE_FILTERS = [['all','Все'],['owner','Собств.'],['tenant','Аренд.'],['contractor','Подряд.'],['concierge','Консьерж'],['security','Охрана'],['admin','Админ']];
  const usersEmptyCopy = getViewStateCopy('admin_users', 'empty');

  function handleOpenAdd() { setAddModal(true); }
  function handleCloseAdd() { setAddModal(false); }

  return (
    <>
      <div className="admin-toolbar admin-toolbar--requests">
        <div className="search-wrap u-mb0">
          <span className="search-ico"><AppIcon name="search" size={13} /></span>
          <input className="search-inp"
            placeholder={contractorOnly ? 'Поиск подрядчика...' : 'Поиск по имени, телефону, апарт...'}
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {!contractorOnly && (
          <>
            <div className="sec-filters-toggle-row">
              <button
                type="button"
                className={`btn-outline sec-filters-toggle${showFilters ? ' active' : ''}`}
                aria-expanded={showFilters}
                onClick={() => setShowFilters(v => !v)}
              >
                <span className="u-inline-icon"><AppIcon name="filter" size={14} /></span>
                <span>Фильтры</span>
                {roleFilter !== 'all' && <span className="pill-count">1</span>}
              </button>
            </div>
            {showFilters && (
              <div className="sec-filters vlog-filters">
                <div className="sec-filter-group">
                  <div className="sec-filter-group-title">Роль</div>
                  <div className="sec-filters-grid sec-filters-grid--roles">
                    {ROLE_FILTERS.map(([k, l]) => (
                      <button key={k} className={`date-pill sm ${roleFilter === k ? 'active' : ''}`} onClick={() => setRoleFilter(k)}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <PageActionBar
          className="admin-toolbar-action"
          primaryLabel={contractorOnly ? '+ Добавить подрядчика' : '＋ Добавить'}
          onPrimary={handleOpenAdd}
        />
      </div>

      {(query || (!contractorOnly && roleFilter !== 'all')) && (
        <div className="u-fs11 u-t4 u-mb8">Найдено: {filtered.length}</div>
      )}
      {filtered.length === 0 && (
        <StateBlock
          type="empty"
          title={query ? 'Ничего не найдено' : usersEmptyCopy.title}
          subtitle={query ? 'Попробуйте изменить запрос' : (contractorOnly ? 'Нажмите «+ Добавить подрядчика»' : usersEmptyCopy.subtitle)}
        />
      )}
      <VirtualList items={filtered} estimateSize={72} renderItem={(u) => <AdminUserRow key={u.uid} u={u} currentUser={currentUser} />} />
      {addModal && <AddUserModal initialRole={contractorOnly ? 'contractor' : undefined} onClose={handleCloseAdd} onDone={() => {}} />}
    </>
  );
});

// ─── AdminRequestsView ────────────────────────────────────────────────────────

// FIX [PERF]: memo — не ре-рендерится при переключении других вкладок
const AdminRequestsView = memo(function AdminRequestsView({ requests, adminUid }: { requests: AppRequest[]; adminUid: string }) {
  const [reqQuery,  setReqQuery]  = useState('');
  const [reqType,   setReqType]   = useState('all');
  const [reqStatus, setReqStatus] = useState('all');
  const [reqPeriod, setReqPeriod] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const debouncedQuery = useDebounce(reqQuery, 150);
  const deferredReqQuery = useDeferredValue(debouncedQuery);
  const rq = deferredReqQuery.trim().toLowerCase();
  const activeFiltersCount = [reqPeriod !== 'all', reqType !== 'all', reqStatus !== 'all'].filter(Boolean).length;

  const filtered = useMemo(() => filterByPeriod(requests, reqPeriod).filter(r => {
    const mq = !rq || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment].some(v => v && v.toLowerCase().includes(rq));
    const mt = reqType === 'all' || r.type === reqType;
    const ms = reqStatus === 'all' || r.status === reqStatus;
    return mq && mt && ms;
  }), [requests, reqPeriod, rq, reqType, reqStatus]);
  const requestsEmptyCopy = getViewStateCopy('admin_requests', 'empty');

  return (
    <>
      <div className="admin-toolbar admin-toolbar--requests">
        <div className="search-wrap u-mb0">
          <span className="search-ico"><AppIcon name="search" size={13} /></span>
          <input className="search-inp" placeholder={'Поиск по имени, апарт., авто...'} value={reqQuery} onChange={e => setReqQuery(e.target.value)} />
        </div>
        <div className="sec-filters-toggle-row">
          <button
            type="button"
            className={`btn-outline sec-filters-toggle${showFilters ? ' active' : ''}`}
            aria-expanded={showFilters}
            onClick={() => setShowFilters(v => !v)}
          >
            <span className="u-inline-icon"><AppIcon name="filter" size={14} /></span>
            <span>{'Фильтры'}</span>
            {activeFiltersCount > 0 && <span className="pill-count">{activeFiltersCount}</span>}
          </button>
        </div>
        {showFilters && (
          <div className="sec-filters vlog-filters">
            <div className="sec-filter-group">
              <div className="sec-filter-group-title">{'Период'}</div>
              <div className="sec-filters-row sec-filters-row--scroll">
                {[["today", 'Сегодня'], ["week", 'Неделя'], ["all", 'Все даты']].map(([k, l]) => (
                  <button key={k} className={`date-pill sm ${reqPeriod === k ? 'active' : ''}`} onClick={() => setReqPeriod(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="sec-filter-group">
              <div className="sec-filter-group-title">{'Тип'}</div>
              <div className="sec-filters-row sec-filters-row--scroll">
                {[["all", 'Все'], ["pass", 'Пропуска'], ["tech", 'Техзаявки']].map(([k, l]) => (
                  <button key={k} className={`date-pill sm ${reqType === k ? 'active' : ''}`} onClick={() => setReqType(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="sec-filter-group">
              <div className="sec-filter-group-title">{'Статус'}</div>
              <div className="sec-filters-grid sec-filters-grid--status">
                {[["all", 'Все статусы'], ["pending", 'В обработке'], ["approved", 'Допуск'], ["rejected", 'Отказ'], ["accepted", 'Принято'], ["expired", 'Истёк']].map(([k, l]) => (
                  <button key={k} className={`date-pill sm ${reqStatus === k ? 'active' : ''}`} onClick={() => setReqStatus(k)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {filtered.length === 0 && <StateBlock type="empty" title={requestsEmptyCopy.title} subtitle={requestsEmptyCopy.subtitle} />}
      <VirtualList items={filtered} estimateSize={100} renderItem={(r) => <AdminReqRow key={r.id} r={r} adminUid={adminUid} />} />
    </>
  );
});

// ??? AdminView ????????????????????????????????????????????????????????????????

export default function AdminView({ user, activeTab, isLoading = false }: { user: AppUser; activeTab: string; isLoading?: boolean }) {
  const requestsSelectorRef = useRef(makeSelectAdminCollections());
  const { requests } = useAppStoreSelector((state) => requestsSelectorRef.current(state));
  const { users } = useUsers();
  // FIX [PERF]: Object.values(users) мемоизирован — не создаёт новый массив при ре-рендерах
  const allUsers = useMemo(() => Object.values(users), [users]);

  return (
    <>
      {activeTab === 'stats'       && <AdminStatsView    allUsers={allUsers} requests={requests} isLoading={isLoading} />}
      {activeTab === 'users'       && <AdminUsersView    allUsers={allUsers} currentUser={user} />}
      {activeTab === 'contractors' && <AdminUsersView    allUsers={allUsers} currentUser={user} contractorOnly />}
      {activeTab === 'requests'    && <AdminRequestsView requests={requests} adminUid={user.uid} />}
      {activeTab === 'perms'       && <AdminPermsView />}
      {activeTab === 'residents'   && <ResidentsView user={user} />}
      {activeTab === 'visitlog'    && <VisitLogView user={user} />}
      {activeTab === 'blacklist'   && <BlacklistView user={user} />}
      {activeTab === 'chat'        && <ChatView user={user} />}
    </>
  );
}
