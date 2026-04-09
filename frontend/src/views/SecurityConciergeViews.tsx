import { useState, useMemo, useCallback, memo, useEffect } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { useRequests, useUsers, useAllPerms } from '../store/AppStore.jsx';
import { ROLE_LABELS } from '../constants/index.js';
import { sortReqs, filterByPeriod } from '../utils.js';
import { isPassRequest, isTechRequest } from '../constants/requestPredicates.js';
import { ReqCard } from '../requests/ReqCard.jsx';
import { CreateModal } from '../requests/CreateModal.jsx';
import { ScanQRModal } from '../requests/ScanQRModal.jsx';
import { ChatView } from '../chat/ChatView.jsx';
import { MyTemplates } from '../perms/PermsList.jsx';
import GuardPostMode from './GuardPostMode.jsx';
import BlacklistView from './BlacklistView.jsx';
import VisitLogView from './VisitLogView.jsx';
import ResidentsView from './ResidentsView.jsx';
import { CarSearchModal } from '../requests/CarSearchModal.jsx';
import { AppIcon } from '../ui/AppIcon.jsx';
import { AvatarCircle } from '../ui/AvatarCircle.jsx';
import StateBlock from '../ui/StateBlock.jsx';
import SectionHeader from '../ui/SectionHeader.jsx';
import PageActionBar from '../ui/PageActionBar.tsx';
import { getViewStateCopy } from '../ui/viewStateContract';
import { OperationalRequestList } from '../requests/OperationalRequestList.tsx';
import { useUrlSearchParams } from '../hooks/useUrlSearchParams';
import { VirtualList } from '../ui/VirtualList.jsx';
import type { RequestStatus, RequestType } from '../store/slices/requestsSlice';

export function ConciergeView({ user, activeTab, setActiveTab }) {
  const requests = useRequests();
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState('');
  const [showScan, setShowScan] = useState(false);
  const debouncedQuery = useDebounce(query, 250);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setQuery(''); }, [activeTab]);

  const normalizedQuery = useMemo(() => debouncedQuery.trim().toLowerCase(), [debouncedQuery]);
  const matchQ = useCallback((r) =>
    !normalizedQuery || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment]
      .some(v => v && v.toLowerCase().includes(normalizedQuery)),
  [normalizedQuery]);

  const allP = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isPassRequest), 'all').filter(matchQ)),
    [requests, matchQ],
  );
  const allT = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isTechRequest), 'all').filter(matchQ)),
    [requests, matchQ],
  );

  const passesEmptyCopy = getViewStateCopy('security_passes', 'empty');
  const techEmptyCopy = getViewStateCopy('security_tech', 'empty');

  const passIcons = [
    ['guest', 'users', 'Гость'],
    ['courier', 'courier', 'Курьер'],
    ['taxi', 'taxi', 'Такси'],
    ['car', 'car', 'Авто'],
    ['master', 'tools', 'Мастер'],
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
            <input className="search-inp" placeholder="Поиск..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="type-grid">
            {passIcons.map(([key, iconName, label]) => (
              <button key={key} type="button" className="type-card" onClick={() => setModal({ type: 'pass', cat: key })}>
                <div className="type-icon"><AppIcon name={iconName} size={20} /></div>
                <div className="type-label">{label}</div>
              </button>
            ))}
          </div>
          <div className="u-flex-center u-mb16">
            <button className={`date-pill${showAll ? ' active' : ''}`} onClick={() => setShowAll(o => !o)}>
              {showAll ? '▴ Скрыть все пропуска' : '▾ Все пропуска'}
            </button>
          </div>
          {showAll && allP.length > 0 && (
            <VirtualList
              items={allP}
              renderItem={(r, i) => (
                <ReqCard key={r.id} req={r} staggerIdx={i} userRole={user.role} userName={user.name} userId={user.uid} />
              )}
              estimateSize={110}
              className="req-list"
            />
          )}
          {showAll && allP.length === 0 && (
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
            {[['electrician', 'tools', 'Электрик'], ['plumber', 'tools', 'Сантехник']].map(([key, iconName, label]) => (
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
            <input className="search-inp" placeholder="Поиск..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          {allT.length > 0 && (
            <>
              <SectionHeader title="Все заявки" count={allT.length} />
              <VirtualList
                items={allT}
                renderItem={(r, i) => (
                  <ReqCard key={r.id} req={r} staggerIdx={i} userRole={user.role} userName={user.name} userId={user.uid} />
                )}
                estimateSize={110}
                className="req-list"
              />
            </>
          )}
          {allT.length === 0 && (
            <StateBlock
              type="empty"
              title={debouncedQuery ? 'Ничего не найдено' : techEmptyCopy.title}
              subtitle={debouncedQuery ? 'Попробуйте другой запрос' : techEmptyCopy.subtitle}
            />
          )}
        </>
      )}

      {activeTab === 'templates' && <MyTemplates user={user} onUse={t => setModal({ type: t.type, cat: t.category, data: t })} />}
      {activeTab === 'residents' && <ResidentsView user={user} />}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'chat' && <ChatView user={user} />}
      {modal && <CreateModal user={user} type={modal.type} initialCat={modal.cat} initialData={modal.data} onClose={() => setModal(null)} onDone={() => {}} />}
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}

const SecurityPermsList = memo(function SecurityPermsList() {
  const [tab, setTab] = useState('visitors');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [openApts, setOpenApts] = useState({});
  const { users } = useUsers();
  const perms = useAllPerms();

  const handleSetTab = (newTab) => {
    setTab(newTab);
    setOpenApts({});
  };

  const residents = useMemo(
    () => Object.values(users)
      .filter(u => u.apartment && u.apartment !== '—')
      .sort((a, b) => Number(a.apartment) - Number(b.apartment)),
    [users],
  );

  const q = debouncedQuery.trim().toLowerCase();
  const permsEmptyCopy = getViewStateCopy('security_perms', 'empty');

  const residentItems = useMemo(() => {
    const matchRes = u => !q || u.apartment.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
    const matchItem = item => !q || item.name.toLowerCase().includes(q) || (item.phone || '').includes(q);

    return residents
      .map(u => {
        const p = perms[u.uid] || { visitors: [], workers: [] };
        const allItems = tab === 'visitors' ? p.visitors : p.workers;
        const list = q ? allItems.filter(item => matchRes(u) || matchItem(item)) : allItems;
        return { u, list };
      })
      .filter(({ list }) => list.length > 0);
  }, [residents, perms, tab, q]);

  const toggleApt = (uid) => setOpenApts(o => ({ ...o, [uid]: !o[uid] }));

  return (
    <div>
      <div className="tabs u-mb10">
        <button className={`tab-btn ${tab === 'visitors' ? 'active' : ''}`} onClick={() => handleSetTab('visitors')}>Посетители</button>
        <button className={`tab-btn ${tab === 'workers' ? 'active' : ''}`} onClick={() => handleSetTab('workers')}>Рабочие</button>
      </div>
      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input className="search-inp" placeholder="Поиск по апартаменту или ФИО..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {residentItems.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : permsEmptyCopy.title}
          subtitle={q ? 'Попробуйте другой запрос' : permsEmptyCopy.subtitle}
        />
      )}
      {residentItems.map(({ u, list }) => {
        const isOpen = openApts[u.uid] === true;
        return (
          <div key={u.uid} className="u-mb8">
            <div className={`spl-apt-row${isOpen ? ' open' : ''}`} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleApt(u.uid)} onClick={() => toggleApt(u.uid)}>
              <div className="spl-apt-info">
                <AvatarCircle avData={null} role={u.role} name={u.name} size={32} fontSize={13} />
                <div>
                  <div className="spl-apt-title">{`Апарт. ${u.apartment}`}</div>
                  <div className="spl-apt-sub">{u.name} · <span className="u-t4">{ROLE_LABELS[u.role]}</span></div>
                </div>
              </div>
              <div className="spl-apt-right">
                <span className="spl-count">{list.length}</span>
                <span className={`spl-arrow${isOpen ? ' open' : ''}`}>▾</span>
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

export function SecurityView({ user, activeTab, setActiveTab, highlightReqId, setHighlightReqId }) {
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [showCarSearch, setShowCarSearch] = useState(false);
  const requests = useRequests();
  const filter = searchParams.get('securityRole') || 'all';
  const typeFilter = (searchParams.get('securityType') || 'all') as 'all' | RequestType;
  const statusFilter = (searchParams.get('securityStatus') || 'all') as 'all' | RequestStatus;
  const datePeriod = searchParams.get('securityPeriod') || 'all';
  const query = searchParams.get('securityQ') || '';
  const [showScan, setShowScan] = useState(false);
  const debouncedQuery = useDebounce(query, 250);

  const updateSecurityFilters = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const pendingPassCount = useMemo(() => requests.filter(r => r.type === 'pass' && r.status === 'pending').length, [requests]);
  const pendingTechCount = useMemo(() => requests.filter(r => r.type === 'tech' && r.status === 'pending').length, [requests]);
  const requestsEmptyCopy = getViewStateCopy('requests', 'empty');

  const shown = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const matchQ = r => !q || [r.createdByName, r.createdByApt, r.visitorName, r.carPlate, r.comment]
      .some(v => v && v.toLowerCase().includes(q));
    return sortReqs(
      filterByPeriod(requests, datePeriod)
        .filter(r => typeFilter === 'all' || r.type === typeFilter)
        .filter(r => statusFilter === 'all' || r.status === statusFilter)
        .filter(r => filter === 'all' || r.createdByRole === filter)
        .filter(matchQ),
    );
  }, [requests, datePeriod, debouncedQuery, typeFilter, statusFilter, filter]);

  const datePills = [['today', 'Сегодня'], ['week', 'Неделя'], ['all', 'Все']];

  return (
    <>
      {activeTab === 'passes' && (
        <>
          <PageActionBar
            className="security-action-btns"
            primaryLabel="Сканировать QR"
            onPrimary={() => setShowScan(true)}
            secondary={[
              { label: 'Поиск авто', onClick: () => setShowCarSearch(true) },
            ]}
          />
          <div className="sec-filters">
            <div className="sec-filters-row">
              <div className="search-wrap u-search-sm">
                <span className="search-ico"><AppIcon name="search" size={14} /></span>
                <input className="search-inp" placeholder="Имя, квартира, авто, комментарий" value={query} onChange={e => updateSecurityFilters({ securityQ: e.target.value.trim() || null })} />
              </div>
              <div className="sec-filters-row sec-filters-row--scroll">
                {datePills.map(([k, l]) => (
                  <button key={k} className={`date-pill ${datePeriod === k ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityPeriod: k })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="sec-filters-row sec-filters-row--scroll">
              {([
                ['all', 'Все', 0],
                ['pass', 'Пропуска', pendingPassCount],
                ['tech', 'Техслужба', pendingTechCount],
              ] as const).map(([k, l, cnt]) => (
                <button key={k} className={`date-pill ${typeFilter === k ? 'active' : ''}${cnt > 0 && k !== 'all' ? ' has-pending' : ''}`} onClick={() => updateSecurityFilters({ securityType: k })}>
                  {l}{cnt > 0 && k !== 'all' ? <span className="tab-pending-badge">{cnt}</span> : null}
                </button>
              ))}
              <span className="sec-filter-divider" aria-hidden="true" />
              {[['all', 'Все'], ['pending', 'В ожидании'], ['approved', 'Одобрены'], ['rejected', 'Отклонены'], ['arrived', 'Вошли'], ['expired', 'Истёкшие']].map(([k, l]) => (
                <button key={k} className={`date-pill sm ${statusFilter === k ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityStatus: k })} title={{ all: 'Все статусы', pending: 'В ожидании', approved: 'Одобрены', rejected: 'Отклонены', arrived: 'Вошли', expired: 'Истёкшие' }[k]}>
                  {l}
                </button>
              ))}
              {typeFilter !== 'tech' && (
                <>
                  <span className="sec-filter-divider" aria-hidden="true" />
                  {[['all', 'Все'], ['owner', 'Собст.'], ['tenant', 'Аренд.'], ['contractor', 'Подр.']].map(([k, l]) => (
                    <button key={k} className={`date-pill sm ${filter === k ? 'active' : ''}`} onClick={() => updateSecurityFilters({ securityRole: k })}>{l}</button>
                  ))}
                </>
              )}
            </div>
          </div>
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
        </>
      )}

      {activeTab === 'perms' && <SecurityPermsList />}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'guardpost' && <GuardPostMode user={user} onViewDetails={(reqId) => { setActiveTab('passes'); setHighlightReqId?.(reqId); }} />}
      {activeTab === 'residents' && <ResidentsView user={user} />}
      {showCarSearch && <CarSearchModal onClose={() => setShowCarSearch(false)} />}
      {activeTab === 'chat' && <ChatView user={user} />}
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}
