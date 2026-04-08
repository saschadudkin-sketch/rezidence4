/**
 * GuardPostMode.jsx — режим «Пост охраны»
 *
 * T-05: компоненты GuardCard, GuardSection, TempPassCard, TechCard
 * вынесены в отдельные файлы views/guard/ для соблюдения SRP.
 *
 * Подвкладки: Активные | Временные пропуска | Техслужба
 * - Активные: pending + approved (одноразовые)
 * - Временные: approved/arrived с passDuration=temporary
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRequests, useBlacklist, useUsers } from '../store/AppStore';
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

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function GuardPostMode({ user, onViewDetails }) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { users } = useUsers();
  const [subTab, setSubTab] = useState('active');
  const [showScan, setShowScan] = useState(false);

  // P-03: поиск на посту охраны
  const [searchQuery, setSearchQuery] = useState('');
  const securityPassesEmptyCopy = getViewStateCopy('security_passes', 'empty');
  const securityTechEmptyCopy = getViewStateCopy('security_tech', 'empty');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const matchSearch = useCallback((r) => {
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.trim().toLowerCase();
    return [r.visitorName, r.carPlate, r.createdByName, r.createdByApt, r.comment]
      .some(v => v && v.toLowerCase().includes(q));
  }, [debouncedSearch]);

  // PERF-03: single memo for base lists — one pass over requests instead of 5
  const { pending, approved, temporary, techPending, techActive } = useMemo(() => {
    const _pending  = [], _approved = [], _tempRaw = [], _techPending = [], _techActive = [];
    for (const r of requests) {
      if (r.type === 'pass') {
        if (r.status === 'pending') { _pending.push(r); }
        else if (r.status === 'approved' && r.passDuration !== 'temporary') { _approved.push(r); }
        else if (r.passDuration === 'temporary' && r.validUntil && (r.status === 'approved' || r.status === 'arrived')) { _tempRaw.push(r); }
      } else if (r.type === 'tech' && (r.status === 'pending' || r.status === 'accepted')) {
        if (r.status === 'pending') _techPending.push(r);
        _techActive.push(r);
      }
    }
    // FIX [PERF]: pre-compute timestamps — new Date() в компараторе = O(n log n) аллокаций
    const withTs = _tempRaw.map(r => ({ r, ts: new Date(r.validUntil).getTime() }));
    withTs.sort((a, b) => a.ts - b.ts);
    return {
      pending:     sortReqs(_pending),
      approved:    sortReqs(_approved),
      temporary:   withTs.map(({ r }) => r),
      techPending: sortReqs(_techPending),
      techActive:  sortReqs(_techActive),
    };
  }, [requests]);

  // PERF-03: single filtered memo — avoids 5 separate useMemo + 5 separate filter passes
  const { filteredPending, filteredApproved, filteredTemporary, filteredTechPending, filteredTechAccepted } = useMemo(() => {
    const techPendingCards  = techActive.filter(r => r.status === 'pending');
    const techAcceptedCards = techActive.filter(r => r.status === 'accepted');
    if (!debouncedSearch.trim()) {
      return {
        filteredPending: pending, filteredApproved: approved, filteredTemporary: temporary,
        filteredTechPending: techPendingCards, filteredTechAccepted: techAcceptedCards,
      };
    }
    return {
      filteredPending:     pending.filter(matchSearch),
      filteredApproved:    approved.filter(matchSearch),
      filteredTemporary:   temporary.filter(matchSearch),
      filteredTechPending: techPendingCards.filter(matchSearch),
      filteredTechAccepted: techAcceptedCards.filter(matchSearch),
    };
  }, [pending, approved, temporary, techActive, matchSearch, debouncedSearch]);

  // Звук при новой pending (pass или tech)
  const prevPassCount = useRef(pending.length);
  const prevTechCount = useRef(techPending.length);
  useEffect(() => {
    if (pending.length > prevPassCount.current) playAlert('pass');
    if (techPending.length > prevTechCount.current) playAlert('tech');
    prevPassCount.current = pending.length;
    prevTechCount.current = techPending.length;
  }, [pending.length, techPending.length]);

  // FIX [PERF]: useCallback — getPhone не пересоздаётся при ре-рендере
  const getPhone = useCallback((uid) => { const u = users[uid]; return u ? u.phone : null; }, [users]);

  return (
    <>
    <div className="guard-post">
      {/* P-03: sticky-баннер "Вы в режиме охраны" — явный контекстный индикатор.
          Охранник всегда видит, что он в режиме поста, и не переключится случайно. */}
      <div className="guard-mode-banner" role="status" aria-label="Активный режим охраны">
        <span className="guard-mode-banner-dot" aria-hidden="true" />
        <span>Режим поста охраны активен</span>
      </div>

      {/* Статистика */}
      <div className="guard-header">
        <div className="guard-header-stats">
          <div className={'guard-stat' + (pending.length > 0 ? ' urgent' : '')}>
            <span className="guard-stat-val">{pending.length}</span>
            <span className="guard-stat-lbl">ожидают</span>
          </div>
          <div className="guard-stat">
            <span className="guard-stat-val">{approved.length}</span>
            <span className="guard-stat-lbl">допущены</span>
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

      {/* QR сканирование */}
      <button className="scan-qr-btn" onClick={() => setShowScan(true)}>
        <span className="u-inline-icon"><AppIcon name="camera" size={18} /></span>
        <span>Сканировать QR-код пропуска</span>
      </button>

      {/* P-03: поиск по гостю, авто, апарт. */}
      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          placeholder="Поиск по имени, авто, апарт.…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Очистить поиск">
            <AppIcon name="close" size={12} />
          </button>
        )}
      </div>

      {/* Подвкладки */}
      <div className="guard-subtabs">
        <button className={'guard-subtab' + (subTab === 'active' ? ' active' : '')} onClick={() => setSubTab('active')}>
          <span className="u-inline-icon"><AppIcon name="shield" size={14} /></span> Активные
          {(pending.length + approved.length) > 0 && <span className="guard-subtab-badge">{pending.length + approved.length}</span>}
        </button>
        <button className={'guard-subtab' + (subTab === 'temp' ? ' active' : '')} onClick={() => setSubTab('temp')}>
          <span className="u-inline-icon"><AppIcon name="clock" size={14} /></span> Временные
          {temporary.length > 0 && <span className="guard-subtab-badge">{temporary.length}</span>}
        </button>
        <button className={'guard-subtab' + (subTab === 'tech' ? ' active' : '') + (techPending.length > 0 ? ' has-new' : '')} onClick={() => setSubTab('tech')}>
          <span className="u-inline-icon"><AppIcon name="tools" size={14} /></span> Техслужба
          {techActive.length > 0 && <span className="guard-subtab-badge">{techActive.length}</span>}
        </button>
      </div>

      {/* Активные */}
      {subTab === 'active' && (
        <>
          {pending.length === 0 && approved.length === 0 && (
            <StateBlock
              type="empty"
              title={securityPassesEmptyCopy.title}
              subtitle={securityPassesEmptyCopy.subtitle}
            />
          )}
          {pending.length > 0 && approved.length > 0 && filteredPending.length === 0 && filteredApproved.length === 0 && (
            <StateBlock type="empty" title="Ничего не найдено" subtitle="Попробуйте другой запрос" />
          )}
          <GuardSection title="Ожидают решения" icon={<AppIcon name="hourglass" size={14} />} count={filteredPending.length}>
            <VirtualList
              items={filteredPending}
              estimateSize={148}
              renderItem={r => (
                <ErrorBoundary key={r.id} name={`Карточка ${r.id}`}>
                  <GuardCard req={r} userName={user.name} blacklist={blacklist} residentPhone={getPhone(r.createdByUid)} onViewDetails={onViewDetails} />
                </ErrorBoundary>
              )}
            />
          </GuardSection>
          <GuardSection title="Допущены" icon={<AppIcon name="check" size={14} />} count={filteredApproved.length}>
            <VirtualList
              items={filteredApproved}
              estimateSize={148}
              renderItem={r => (
                <ErrorBoundary key={r.id} name={`Карточка ${r.id}`}>
                  <GuardCard req={r} userName={user.name} blacklist={blacklist} residentPhone={getPhone(r.createdByUid)} onViewDetails={onViewDetails} />
                </ErrorBoundary>
              )}
            />
          </GuardSection>
        </>
      )}

      {/* Временные */}
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
            {filteredTemporary.map(r => (
              <ErrorBoundary key={r.id} name={`Временный пропуск ${r.id}`}>
                <TempPassCard req={r} userName={user.name} blacklist={blacklist} residentPhone={getPhone(r.createdByUid)} />
              </ErrorBoundary>
            ))}
          </div>
        </>
      )}

      {/* Техслужба */}
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
            {filteredTechPending.map(r => (
              <ErrorBoundary key={r.id} name={`Техзаявка ${r.id}`}>
                <TechCard req={r} userName={user.name} residentPhone={getPhone(r.createdByUid)} />
              </ErrorBoundary>
            ))}
          </GuardSection>
          <GuardSection title="В работе" icon={<AppIcon name="tools" size={14} />} count={filteredTechAccepted.length}>
            {filteredTechAccepted.map(r => (
              <ErrorBoundary key={r.id} name={`Техзаявка ${r.id}`}>
                <TechCard req={r} userName={user.name} residentPhone={getPhone(r.createdByUid)} />
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
