import { useState, useMemo, useCallback, memo } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { useRequests, useUsers, useAllPerms } from '../store/AppStore';
import { ROLE_COLOR, ROLE_LABELS } from '../constants/index';
import { sortReqs, filterByPeriod } from '../utils';
import { isPassRequest, isTechRequest } from '../constants/requestPredicates';
import { ReqCard } from '../requests/ReqCard';
import { CreateModal } from '../requests/CreateModal';
import { ScanQRModal } from '../requests/ScanQRModal';
import { ChatView } from '../chat/ChatView';
import { MyTemplates } from '../perms/PermsList';
import GuardPostMode from './GuardPostMode';
import BlacklistView from './BlacklistView';
import VisitLogView from './VisitLogView';
import ResidentsView from './ResidentsView';
import { CarSearchModal } from '../requests/CarSearchModal';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import SectionHeader from '../ui/SectionHeader';

// ─── CONCIERGE VIEW ───────────────────────────────────────────────────────────

export function ConciergeView({ user, activeTab, setActiveTab }) {
  const requests = useRequests();
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState('');
  const [showScan, setShowScan] = useState(false);
  const debouncedQuery = useDebounce(query, 250);
  const [showAll, setShowAll] = useState(false);

  // FIX [AUDIT-2 #23perf]: вычисляем один раз, а не для каждого поля каждой заявки
  const normalizedQuery = useMemo(() => debouncedQuery.trim().toLowerCase(), [debouncedQuery]);

  const matchQ = useCallback(r =>
    !normalizedQuery || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment]
      .some(v => v && v.toLowerCase().includes(normalizedQuery)),
  [normalizedQuery]);

  const allP = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isPassRequest), 'all').filter(matchQ)),
    [requests, matchQ]
  );
  const allT = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isTechRequest), 'all').filter(matchQ)),
    [requests, matchQ]
  );

  const pIcons = [['guest', 'users', 'Гость'], ['courier', 'file', 'Курьер'], ['taxi', 'car', 'Такси'], ['car', 'car', 'Авто'], ['master', 'tools', 'Мастер']];

  return (<>
    {activeTab === 'passes' && (<>
      {/* ВАЖНО-1: role reminder — approvals belong to security, not concierge */}
      <div className="concierge-role-hint" role="note">
        <AppIcon name="info" size={14} className="u-inline-icon" />
        <span>Консьерж контролирует доступ и создаёт заявки. Одобрение — задача охраны.</span>
      </div>
      <button className="scan-qr-btn" onClick={() => setShowScan(true)}>
        <span className="u-inline-icon"><AppIcon name="camera" size={18} /></span>
        <span>Сканировать QR-код</span>
      </button>
      <div className="search-wrap">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" placeholder="Поиск..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="type-grid">
        {pIcons.map(([k, iconName, l]) => (
          <div key={k} className="type-card" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && e.currentTarget.click()} onClick={() => setModal({ type: 'pass', cat: k })}>
            <div className="type-icon"><AppIcon name={iconName} size={20} /></div>
            <div className="type-label">{l}</div>
          </div>
        ))}
      </div>
      <div className="u-flex-center u-mb16">
        <button className={'date-pill' + (showAll ? ' active' : '')} onClick={() => setShowAll(o => !o)}>
          {showAll ? '▴ Скрыть все пропуска' : '▾ Все пропуска'}
        </button>
      </div>
      {showAll && allP.length > 0 && <div className="req-list">{allP.map((r, i) => <ReqCard key={r.id} req={r} staggerIdx={i} userRole={user.role} userName={user.name} userId={user.uid} />)}</div>}
      {showAll && allP.length === 0 && (
        <StateBlock
          type="empty"
          title="Пропусков нет"
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : 'Заявки на пропуск не найдены'}
        />
      )}
    </>)}

    {activeTab === 'tech' && (<>
      <div className="type-grid">
        {[['electrician', 'chart', 'Электрик'], ['plumber', 'tools', 'Сантехник']].map(([k, iconName, l]) => (
          <div key={k} className="type-card" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && e.currentTarget.click()} onClick={() => setModal({ type: 'tech', cat: k })}>
            <div className="type-icon"><AppIcon name={iconName} size={20} /></div>
            <div className="type-label">{l}</div>
          </div>
        ))}
        <div className="type-card" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && e.currentTarget.click()} onClick={() => setActiveTab('templates')} style={{ borderColor: activeTab === 'templates' ? 'var(--g2)' : 'var(--b1)' }}>
          <div className="type-icon"><AppIcon name="file" size={20} /></div>
          <div className="type-label">Шаблоны</div>
        </div>
      </div>
      <div className="search-wrap">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" placeholder="Поиск..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {allT.length > 0 && <>
        <SectionHeader title="Все заявки" count={allT.length} />
        <div className="req-list">{allT.map((r, i) => <ReqCard key={r.id} req={r} staggerIdx={i} userRole={user.role} userName={user.name} userId={user.uid} />)}</div>
      </>}
      {allT.length === 0 && (
        <StateBlock
          type="empty"
          title="Техзаявок нет"
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : 'Заявки в техслужбу не найдены'}
        />
      )}
    </>)}

    {activeTab === 'templates' && <MyTemplates user={user} onUse={t => setModal({ type: t.type, cat: t.category, data: t })} />}
    {activeTab === 'residents' && <ResidentsView user={user} />}
    {activeTab === 'visitlog' && <VisitLogView user={user} />}
    {activeTab === 'blacklist' && <BlacklistView user={user} />}
    {activeTab === 'chat' && <ChatView user={user} />}
    {modal && <CreateModal user={user} type={modal.type} initialCat={modal.cat} initialData={modal.data} onClose={() => setModal(null)} onDone={() => {}} />}
    {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
  </>);
}

// ─── SECURITY PERMS LIST ──────────────────────────────────────────────────────

// FIX [MEMO]: SecurityPermsList не имеет пропсов — без memo пересоздавался
// при каждом изменении activeTab в SecurityView (переключение любой другой вкладки).
// С memo React пропускает рендер если нет изменений в useContext-зависимостях.
const SecurityPermsList = memo(function SecurityPermsList() {
  const [tab, setTab] = useState('visitors');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [openApts, setOpenApts] = useState({});

  // FIX [AUDIT-7]: openApts не сбрасывался при смене вкладки visitors↔workers.
  // Список посетителей и рабочих разный, раскрытые апартаменты были "призраками"
  // из предыдущей вкладки — визуально пустые аккордеоны без данных.
  const handleSetTab = (newTab) => {
    setTab(newTab);
    setOpenApts({});
  };
  const { users } = useUsers();
  const perms = useAllPerms();

  // FIX [PERF]: мемоизируем — Object.values(users) при каждом рендере
  const residents = useMemo(() =>
    Object.values(users)
      .filter(u => u.apartment && u.apartment !== '—')
      .sort((a, b) => Number(a.apartment) - Number(b.apartment)),
  [users]);

  const q = debouncedQuery.trim().toLowerCase();

  const residentItems = useMemo(() => {
    const matchRes  = u    => !q || u.apartment.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
    const matchItem = item => !q || item.name.toLowerCase().includes(q) || (item.phone || '').includes(q);

    return residents
      .map(u => {
        const p        = perms[u.uid] || { visitors: [], workers: [] };
        const allItems = tab === 'visitors' ? p.visitors : p.workers;
        const list     = q
          ? allItems.filter(item => matchRes(u) || matchItem(item))
          : allItems;
        return { u, list };
      })
      .filter(({ list }) => list.length > 0);
  }, [residents, perms, tab, q]);

  const toggleApt = uid => setOpenApts(o => ({ ...o, [uid]: !o[uid] }));

  return (
    <div>
      <div className="tabs u-mb10">
        <button className={'tab-btn ' + (tab === 'visitors' ? 'active' : '')} onClick={() => handleSetTab('visitors')}>Посетители</button>
        <button className={'tab-btn ' + (tab === 'workers'  ? 'active' : '')} onClick={() => handleSetTab('workers')}>Рабочие</button>
      </div>
      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" placeholder="Поиск по апартаменту или ФИО..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {residentItems.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : tab === 'visitors' ? 'Посетителей нет' : 'Рабочих нет'}
          subtitle={q ? 'Попробуйте другой запрос' : 'Резиденты ещё не добавили постоянных ' + (tab === 'visitors' ? 'посетителей' : 'рабочих')}
        />
      )}
      {residentItems.map(({ u, list }) => {
        const isOpen = openApts[u.uid] === true;
        return (
          <div key={u.uid} className="u-mb8">
            <div className={'spl-apt-row' + (isOpen ? ' open' : '')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleApt(u.uid)} onClick={() => toggleApt(u.uid)}>
              <div className="spl-apt-info">
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: ROLE_COLOR[u.role] || 'var(--s4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 600, color: '#fff', flexShrink: 0 }}>{u.name.charAt(0)}</div>
                <div>
                  <div className="spl-apt-title">{'Апарт. ' + u.apartment}</div>
                  <div className="spl-apt-sub">{u.name} · <span className="u-t4">{ROLE_LABELS[u.role]}</span></div>
                </div>
              </div>
              <div className="spl-apt-right">
                <span className="spl-count">{list.length}</span>
                <span className={'spl-arrow' + (isOpen ? ' open' : '')}>▾</span>
              </div>
            </div>
            {isOpen && (
              <div className="spl-items">
                {list.map(item => (
                  <div key={item.id} className="spl-item">
                    <div className="perm-info">
                      <div className="perm-name">{item.name}</div>
                      <div className="perm-meta">{[item.phone, item.carPlate].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ─── SECURITY VIEW ────────────────────────────────────────────────────────────

export function SecurityView({ user, activeTab, setActiveTab, highlightReqId, setHighlightReqId }) {
  const [showCarSearch, setShowCarSearch] = useState(false);
  const requests = useRequests();
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [datePeriod, setDatePeriod] = useState('all');
  const [query, setQuery] = useState('');
  const [showScan, setShowScan] = useState(false);
  const debouncedQuery = useDebounce(query, 250);

  const pendingPassCount = useMemo(() => requests.filter(r => r.type === 'pass' && r.status === 'pending').length, [requests]);
  const pendingTechCount = useMemo(() => requests.filter(r => r.type === 'tech' && r.status === 'pending').length, [requests]);

  const shown = useMemo(() => {
    const allFiltered = sortReqs(filterByPeriod(requests, datePeriod));
    const q = debouncedQuery.trim().toLowerCase();
    const matchQ = r => !q || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment]
      .some(v => v && v.toLowerCase().includes(q));
    return sortReqs(
      allFiltered
        .filter(r => typeFilter === 'all' || r.type === typeFilter)
        .filter(r => statusFilter === 'all' || r.status === statusFilter)
        .filter(r => filter === 'all' || r.createdByRole === filter)
        .filter(matchQ)
    );
  }, [requests, datePeriod, debouncedQuery, typeFilter, statusFilter, filter]);

  const datePills = [['today','Сегодня'],['week','Неделя'],['all','Все']];

  return (<>
    {activeTab === 'passes' && (<>
      <div className="security-action-btns">
        <button className="scan-qr-btn" onClick={() => setShowScan(true)}>
          <span className="u-inline-icon"><AppIcon name="camera" size={18} /></span>
          <span>Сканировать QR</span>
        </button>
        <button className="scan-qr-btn car-search-trigger" onClick={() => setShowCarSearch(true)}>
          <span className="u-inline-icon"><AppIcon name="car" size={18} /></span>
          <span>Поиск авто</span>
        </button>
      </div>
      <div className="sec-filters">
        <div className="sec-filters-row">
          <div className="search-wrap u-search-sm">
            <span className="search-ico"><AppIcon name="search" size={14} /></span>
            <input className="search-inp" placeholder="Поиск..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="date-pills u-mb0">
            {datePills.map(([k, l]) => <button key={k} className={'date-pill ' + (datePeriod === k ? 'active' : '')} onClick={() => setDatePeriod(k)}>{l}</button>)}
          </div>
        </div>
        <div className="sec-filters-row">
          {[
            ['all', 'Все', 0],
            ['pass', 'Пропуска', pendingPassCount],
            ['tech', 'Техслужба', pendingTechCount],
          ].map(([k, l, cnt]) => (
            <button key={k} className={'date-pill ' + (typeFilter === k ? 'active' : '') + (cnt > 0 && k !== 'all' ? ' has-pending' : '')} onClick={() => setTypeFilter(k)}>
              {l}{cnt > 0 && k !== 'all' ? <span className="tab-pending-badge">{cnt}</span> : null}
            </button>
          ))}
          <span className="sec-filter-sep">│</span>
          {[['all', 'Все'], ['pending', 'В ожидании'], ['approved', 'Одобрены'], ['rejected', 'Отклонены'], ['arrived', 'Вошли'], ['expired', 'Истёкшие']].map(([k, l]) => (
            <button key={k} className={'date-pill sm ' + (statusFilter === k ? 'active' : '')} onClick={() => setStatusFilter(k)} title={{'all':'Все статусы','pending':'В ожидании','approved':'Одобрены','rejected':'Отклонены','arrived':'Вошли','expired':'Истёкшие'}[k]}>{l}</button>
          ))}
          {typeFilter !== 'tech' && <>
            <span className="sec-filter-sep">│</span>
            {[['all','Все'],['owner','Собст.'],['tenant','Аренд.'],['contractor','Подр.']].map(([k, l]) => (
              <button key={k} className={'date-pill sm ' + (filter === k ? 'active' : '')} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </>}
        </div>
      </div>
      {shown.length === 0
        ? <StateBlock
            type="empty"
            title={query ? 'Ничего не найдено' : 'Заявок нет'}
            subtitle={query ? 'Попробуйте другой запрос' : 'Нет активных заявок за выбранный период'}
          />
        : <div className="req-list">{shown.map((r, i) => <ReqCard key={r.id} req={r} staggerIdx={i} userRole={user.role} userName={user.name} userId={user.uid} highlightId={highlightReqId} onHighlighted={() => setHighlightReqId && setHighlightReqId(null)} />)}</div>}
    </>)}

    {activeTab === 'perms' && <SecurityPermsList />}
    {activeTab === 'visitlog' && <VisitLogView user={user} />}
    {activeTab === 'blacklist' && <BlacklistView user={user} />}
    {activeTab === 'guardpost' && <GuardPostMode user={user} onViewDetails={(reqId) => { setActiveTab('passes'); setHighlightReqId && setHighlightReqId(reqId); }} />}
    {activeTab === 'residents' && <ResidentsView user={user} />}
    {showCarSearch && <CarSearchModal onClose={() => setShowCarSearch(false)} />}
    {activeTab === 'chat' && <ChatView user={user} />}
    {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
  </>);
}
