import { useState, useMemo, memo, useDeferredValue } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { useRequests, useUsers } from '../store/AppStore';
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
const AdminStatsView = memo(function AdminStatsView({ allUsers, requests, isLoading }) {
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
      ],
      roleCount: allUsers.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {}),
    };
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
          return (
            <div key={role} className="u-pad12-16 role-stat-row">
              <div className="u-flex-between u-mb8">
                <span className="u-fs13 u-t1 u-flex-center u-gap8">
                  <span className={`u-role-dot ${ROLE_COLOR[role] ? role : 'default'}`} />
                  {ROLE_LABELS[role]}
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
const AdminUsersView = memo(function AdminUsersView({ allUsers, currentUser, contractorOnly = false }) {
  const [addModal,   setAddModal]   = useState(false);
  const [query,      setQuery]      = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
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
      <div className="admin-toolbar">
        <div className="search-wrap u-mb0">
          <span className="search-ico"><AppIcon name="search" size={13} /></span>
          <input className="search-inp"
            placeholder={contractorOnly ? 'Поиск подрядчика...' : 'Поиск по имени, телефону, апарт...'}
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {!contractorOnly && (
          <div className="date-pills u-mb0">
            {ROLE_FILTERS.map(([k, l]) => (
              <button key={k} className={'date-pill ' + (roleFilter === k ? 'active' : '')} onClick={() => setRoleFilter(k)}>{l}</button>
            ))}
          </div>
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
const AdminRequestsView = memo(function AdminRequestsView({ requests, adminUid }) {
  const [reqQuery,  setReqQuery]  = useState('');
  const [reqType,   setReqType]   = useState('all');
  const [reqStatus, setReqStatus] = useState('all');
  const [reqPeriod, setReqPeriod] = useState('all');
  const debouncedQuery = useDebounce(reqQuery, 150);
  const deferredReqQuery = useDeferredValue(debouncedQuery);
  const rq = deferredReqQuery.trim().toLowerCase();

  const filtered = useMemo(() => filterByPeriod(requests, reqPeriod).filter(r => {
    const mq = !rq || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment].some(v => v && v.toLowerCase().includes(rq));
    const mt = reqType   === 'all' || r.type   === reqType;
    const ms = reqStatus === 'all' || r.status === reqStatus;
    return mq && mt && ms;
  }), [requests, reqPeriod, rq, reqType, reqStatus]);
  const requestsEmptyCopy = getViewStateCopy('admin_requests', 'empty');

  return (
    <>
      <div className="admin-toolbar">
        <div className="search-wrap u-mb0">
          <span className="search-ico"><AppIcon name="search" size={13} /></span>
          <input className="search-inp" placeholder="Поиск по имени, апарт., авто..." value={reqQuery} onChange={e => setReqQuery(e.target.value)} />
        </div>
        <div className="date-pills u-mb0">
          {[['today','Сегодня'],['week','Неделя'],['all','Все даты']].map(([k, l]) => (
            <button key={k} className={'date-pill ' + (reqPeriod === k ? 'active' : '')} onClick={() => setReqPeriod(k)}>{l}</button>
          ))}
        </div>
        <div className="date-pills u-mb0">
          {[['all','Все'],['pass','Пропуска'],['tech','Техзаявки']].map(([k, l]) => (
            <button key={k} className={'date-pill ' + (reqType === k ? 'active' : '')} onClick={() => setReqType(k)}>{l}</button>
          ))}
        </div>
        <div className="date-pills u-mb0">
          {[['all','Все статусы'],['pending','В обработке'],['approved','Допуск'],['rejected','Отказ'],['accepted','Принято'],['expired','Истёк']].map(([k, l]) => (
            <button key={k} className={'date-pill ' + (reqStatus === k ? 'active' : '')} onClick={() => setReqStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 && <StateBlock type="empty" title={requestsEmptyCopy.title} subtitle={requestsEmptyCopy.subtitle} />}
      <VirtualList items={filtered} estimateSize={100} renderItem={(r) => <AdminReqRow key={r.id} r={r} adminUid={adminUid} />} />
    </>
  );
});

// ─── AdminView ────────────────────────────────────────────────────────────────

export default function AdminView({ user, activeTab }) {
  const requests = useRequests();
  const { users } = useUsers();
  // FIX [PERF]: Object.values(users) мемоизирован — не создаёт новый массив при ре-рендерах
  const allUsers = useMemo(() => Object.values(users), [users]);

  return (
    <>
      {activeTab === 'stats'       && <AdminStatsView    allUsers={allUsers} requests={requests} isLoading={allUsers.length === 0} />}
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
