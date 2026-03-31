/**
 * GuardPostMode.jsx — режим «Пост охраны»
 *
 * Подвкладки: Активные | Временные пропуска
 * - Активные: pending + approved (одноразовые)
 * - Временные: approved/arrived с passDuration=temporary
 */

import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useRequests, useActions, useBlacklist, useUsers, useAvatar } from '../store/AppStore.jsx';
import { CAT_LABEL } from '../constants/index.js';
import { sortReqs, playAlert } from '../utils.js';
import { AvatarCircle } from '../ui/AvatarCircle.jsx';
import { PassQRModal } from '../requests/PassQRModal.jsx';
import { checkBlacklist } from '../store/slices/blacklistSlice';
import { toast } from '../ui/Toasts.jsx';
import { ScanQRModal } from '../requests/ScanQRModal.jsx';
import { pushNotifyResident } from '../services/pushNotification';
import { sendNotif } from '../utils';
import { logVisit } from '../shared/api/passesApi';
import ErrorBoundary from '../ui/ErrorBoundary';
import { AppIcon } from '../ui/AppIcon.jsx';

// ─── Карточка пропуска ───────────────────────────────────────────────────────

// FIX [PERF-5]: memo — GuardCard рендерится для каждой заявки в списке.
// Без memo перерендер при любом изменении requests (например, SSE-обновление одной карточки)
// вызывал полный ре-рендер ВСЕХ видимых GuardCard включая useAvatar/useActions хуки.
const GuardCard = memo(function GuardCard({ req, userName, blacklist, residentPhone, onViewDetails }) {
  const { approveRequest, rejectRequest, arriveRequest, approveAndArrive } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading]             = useState(null);
  const [showQR, setShowQR]               = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReject, setConfirmReject]   = useState(false);
  const blMatch = checkBlacklist(req, blacklist);

  // Одиночный тап открывает детали (двойной тап убран — неочевидный UX для охраны)
  const handleInfoTap = () => {
    if (!onViewDetails) return;
    onViewDetails(req.id);
  };

  // FIX [BUG-21]: добавляем isMountedRef — setLoading(null) в finally мог вызваться
  // на размонтированной карточке (например, заявка удалена пока шёл запрос).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // loadingRef стабилен — нет stale closure
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const act = useCallback(async (key, fn, msg, type) => {
    if (loadingRef.current) return;
    if (!isMountedRef.current) return;
    setLoading(key);
    try {
      await fn();
      if (isMountedRef.current) toast(msg, type);
    } catch(e) {
      console.warn('[GuardCard] action error:', e);
      if (isMountedRef.current) toast('Ошибка операции', 'error');
    } finally {
      if (isMountedRef.current) setLoading(null);
    }
  }, []); // стабильный callback — оба ref читаются в момент вызова

  const doPass = () => {
    if (req.passDuration === 'once' || !req.passDuration) {
      act('approve', async () => {
        approveAndArrive(req.id, userName, 'security');
        pushNotifyResident(req);
        await logVisit({
          userId: req.createdByUid || req.id,
          requestId: req.id,
          timestamp: new Date().toISOString(),
          result: 'allowed',
          reason: 'ok',
          actorName: userName,
          actorRole: 'security',
          visitorName: req.visitorName || null,
          category: req.category,
          createdByApt: req.createdByApt,
          createdByName: req.createdByName,
          createdByUid: req.createdByUid || null,
        }).catch(() => {});
      }, 'Гость допущен', 'success');
    } else {
      act('approve', () => {
        approveRequest(req.id, userName, 'security');
        sendNotif('Допуск открыт', (req.visitorName || 'Гость') + ' — пропуск одобрен', 'status-' + req.id);
      }, 'Допуск открыт', 'success');
    }
  };
  const doReject = () => {
    act('reject', () => {
      rejectRequest(req.id, userName, 'security');
      sendNotif('В допуске отказано', (req.visitorName || 'Гость') + ' — охрана отклонила заявку', 'status-' + req.id);
    }, 'В допуске отказано', 'error');
    setConfirmReject(false);
    setConfirmApprove(false);
  };
  const doArrive = () => act('arrive', async () => {
    arriveRequest(req.id, userName, 'security');
    pushNotifyResident(req);
    await logVisit({
      userId: req.createdByUid || req.id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
      result: 'allowed',
      reason: 'ok',
      actorName: userName,
      actorRole: 'security',
      visitorName: req.visitorName || null,
      category: req.category,
      createdByApt: req.createdByApt,
      createdByName: req.createdByName,
      createdByUid: req.createdByUid || null,
    });
  }, 'Вход отмечен', 'success');

  return (
    <div className={'guard-card' + (blMatch ? ' bl-flagged' : '')} role="article">
      {blMatch && (
        <div className="bl-warning">
          <span className="u-inline-icon"><AppIcon name="denied" size={22} /></span>
          <div>
            <div className="bl-warning-text">ЧЁРНЫЙ СПИСОК</div>
            <div className="bl-warning-detail">
              {blMatch.name && <span>{blMatch.name} </span>}
              {blMatch.carPlate && <span>{blMatch.carPlate} </span>}
              {blMatch.reason && <span>— {blMatch.reason}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="guard-card-top">
        <div className="guard-avatar">
          <AvatarCircle avData={avData} role={req.createdByRole} name={req.createdByName || '?'} size={48} fontSize={18} />
        </div>
        <div className="guard-info" onClick={handleInfoTap}
          style={{ cursor: onViewDetails ? 'pointer' : 'default' }}
          role={onViewDetails ? 'button' : undefined}
          tabIndex={onViewDetails ? 0 : undefined}
          aria-label={onViewDetails ? 'Подробнее о заявке' : undefined}
          onKeyDown={onViewDetails ? (e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleInfoTap())) : undefined}>
          <div className="guard-apt">
            {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt : ''}
          </div>
          <div className="guard-name">{req.createdByName}</div>
          <div className="guard-cat">{CAT_LABEL[req.category] || req.category}</div>
          
        </div>
        {onViewDetails && (
          <button className="guard-detail-btn" onClick={() => onViewDetails(req.id)} title="Подробнее">
            <AppIcon name="info" size={14} />
          </button>
        )}
      </div>

      {(req.visitorName || req.carPlate || req.comment) && (
        <div className="guard-details">
          {req.visitorName && <div className="guard-detail"><span className="guard-detail-lbl">Гость</span><span className="guard-detail-val">{req.visitorName}</span></div>}
          {req.carPlate && <div className="guard-detail"><span className="guard-detail-lbl">Авто</span><span className="guard-detail-val">{req.carPlate}</span></div>}
          {req.comment && <div className="guard-detail"><span className="guard-detail-lbl">Коммент.</span><span className="guard-detail-val">{req.comment}</span></div>}
        </div>
      )}

      {req.status === 'approved' && (
        <button className="qr-pass-btn" onClick={() => setShowQR(true)} style={{ marginBottom: 0 }}>
          <span className="u-inline-icon"><AppIcon name="phone" size={18} /></span>
          <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>Показать QR-код</div></div>
        </button>
      )}
      {showQR && <PassQRModal req={req} onClose={() => setShowQR(false)} />}

      {/* Фото заявки */}
      {(req.photos?.length > 0 || req.photo) && (
        <div className="guard-photos">
          {/* FIX [SEC-17]: window.open(_blank) без noopener позволяет открытой вкладке
              обращаться к window.opener (tabnapping-атака). Используем ссылку вместо window.open. */}
          {(req.photos || (req.photo ? [req.photo] : [])).slice(0, 3).map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt="фото" className="guard-photo-thumb" />
            </a>
          ))}
        </div>
      )}

      <div className="guard-actions">
        {req.status === 'pending' && (
          <>
            {confirmApprove ? (
              <button className="guard-btn approve confirm" onClick={doPass} disabled={!!loading}>
                {loading === 'approve' ? <span className="btn-spin" /> : <AppIcon name="check" size={14} />}
                <span>Точно пропустить?</span>
              </button>
            ) : (
              <button className="guard-btn approve" onClick={() => setConfirmApprove(true)} disabled={!!loading}>
                <span className="u-inline-icon"><AppIcon name="check" size={14} /></span><span>Пропустить</span>
              </button>
            )}
            {confirmReject ? (
              <button className="guard-btn reject confirm" onClick={doReject} disabled={!!loading}>
                {loading === 'reject' ? <span className="btn-spin" /> : <AppIcon name="alert" size={14} />}
                <span>Точно отказать?</span>
              </button>
            ) : (
              <button className="guard-btn reject" onClick={() => setConfirmReject(true)} disabled={!!loading}>
                <span className="u-inline-icon"><AppIcon name="close" size={14} /></span><span>Отказать</span>
              </button>
            )}
          </>
        )}
        {req.status === 'approved' && (req.passDuration === 'permanent' || req.passDuration === 'temporary') && (
          <button className="guard-btn arrive" onClick={doArrive} disabled={!!loading}>
            {loading === 'arrive' ? <span className="btn-spin" /> : <AppIcon name="door" size={14} />}
            <span>Отметить вход</span>
          </button>
        )}
        {/* FIX [BUG]: дубликат блока фото удалён — фото уже рендерятся в guard-photos выше */}
        {residentPhone && (
          <a href={'tel:' + residentPhone.replace(/\s/g, '')} className="guard-btn call">
            <AppIcon name="phone" size={14} /> <span>Позвонить жильцу</span>
          </a>
        )}
      </div>
    </div>
  );
});

// ─── Секция ──────────────────────────────────────────────────────────────────

// GuardSection не имеет тяжёлых дочерних хуков — children рендерятся снаружи.
// memo здесь не нужен: он мемоизирован на уровне children (GuardCard/TechCard).
function GuardSection({ title, icon, count, children }) {
  if (count === 0) return null;
  return (
    <div className="guard-section">
      <div className="guard-section-head">
        <span className="u-inline-icon">{icon} <span>{title}</span></span>
        <span className="guard-section-count">{count}</span>
      </div>
      <div className="guard-list">{children}</div>
    </div>
  );
}

// ─── Строка временного пропуска ──────────────────────────────────────────────

// FIX [PERF-5]: memo — TempPassCard рендерится для каждого временного пропуска.
// useMemo внутри компонента (expired/timeLeft) не спасает от самого ре-рендера.
const TempPassCard = memo(function TempPassCard({ req, userName, residentPhone, blacklist }) {
  const { arriveRequest } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading] = useState(false);
  const blMatch = checkBlacklist(req, blacklist);

  // FIX [PERF]: useMemo — exp/diff пересчитываются только при смене req.validUntil
  // (каждую минуту данные всё равно обновляются через SSE при реальном изменении статуса)
  const { expired, timeLeft, diff } = useMemo(() => {
    const exp  = new Date(req.validUntil);
    const diff = exp - new Date();
    const expired = diff <= 0;
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const timeLeft = expired ? 'Истёк'
      : days > 0 ? `${days}д ${hours}ч`
      : hours > 0 ? `${hours}ч ${mins}мин`
      : `${mins}мин`;
    return { expired, timeLeft, diff };
  }, [req.validUntil]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const doArrive = async () => {
    if (loading) return;
    setLoading(true);
    // FIX [BUG-2]: убран fire-and-forget setTimeout async.
    // а) setTimeout не является awaitable — ошибки внутри async callback
    //    не всплывают в вызывающий код, finally не связан с логикой вызова.
    // б) setState вызывался на потенциально unmounted компоненте.
    // РЕШЕНИЕ: прямой async/await + isMounted guard.
    try {
      arriveRequest(req.id, userName, 'security');
      if (isMountedRef.current) toast('Вход отмечен', 'success');
    } catch(e) {
      if (isMountedRef.current) toast('Ошибка операции', 'error');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  return (
    <div className={'guard-card' + (expired ? ' expired' : '') + (blMatch ? ' bl-flagged' : '')}>
      {blMatch && (
        <div className="bl-warning">
          <span className="u-inline-icon"><AppIcon name="denied" size={22} /></span>
          <div><div className="bl-warning-text">ЧЁРНЫЙ СПИСОК</div></div>
        </div>
      )}
      <div className="guard-card-top">
        <div className="guard-avatar">
          <AvatarCircle avData={avData} role={req.createdByRole} name={req.createdByName || '?'} size={42} fontSize={16} />
        </div>
        <div className="guard-info">
          <div className="guard-apt">
            {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt : ''}
          </div>
          <div className="guard-name">{req.createdByName}</div>
          <div className="guard-cat">{req.visitorName || CAT_LABEL[req.category] || req.category}</div>
        </div>
        <div className={'guard-temp-expiry' + (expired ? ' expired' : diff < 3600000 ? ' soon' : '')}>
          <span className="u-inline-icon">
            <AppIcon name={expired ? 'denied' : diff < 3600000 ? 'alert' : 'history'} size={13} />
          </span>{' '}
          {timeLeft}
        </div>
      </div>

      {req.status === 'approved' && !expired && (
        <div className="guard-actions">
          <button className="guard-btn arrive" onClick={doArrive} disabled={loading}>
            {loading ? <span className="btn-spin" /> : <AppIcon name="door" size={14} />}
            <span>Отметить вход</span>
          </button>
          {residentPhone && (
            <a href={'tel:' + residentPhone.replace(/\s/g, '')} className="guard-btn call">
              <AppIcon name="phone" size={14} /> <span>Позвонить</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Карточка техзаявки ─────────────────────────────────────────────────────

// FIX [PERF-5]: memo — аналогично TempPassCard
const TechCard = memo(function TechCard({ req, userName, residentPhone }) {
  const { acceptRequest } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading] = useState(null);

  // FIX [REACT]: useCallback([loading,...]) — stale closure, пересоздаёт fn при каждом изм. loading
  // Исправлено через loadingRef (аналогично GuardCard)
  // FIX [BUG-21]: добавлен isMountedRef — setLoading(null) без него вызывался на unmounted компоненте
  const techIsMountedRef = useRef(true);
  useEffect(() => {
    techIsMountedRef.current = true;
    return () => { techIsMountedRef.current = false; };
  }, []);
  const techLoadingRef = useRef(loading);
  techLoadingRef.current = loading;
  const doAccept = useCallback(async () => {
    if (techLoadingRef.current) return;
    if (!techIsMountedRef.current) return;
    setLoading('accept');
    try {
      acceptRequest(req.id, userName, 'security');
      if (techIsMountedRef.current) toast('Принято в работу', 'success');
    } catch(e) {
      if (techIsMountedRef.current) toast('Ошибка', 'error');
    } finally {
      if (techIsMountedRef.current) setLoading(null);
    }
  }, [acceptRequest, req.id, userName]); // стабильный — оба ref читаются в момент вызова

  return (
    <div className="guard-card">
      <div className="guard-card-top">
        <div className="guard-avatar">
          <AvatarCircle avData={avData} role={req.createdByRole} name={req.createdByName || '?'} size={42} fontSize={16} />
        </div>
        <div className="guard-info">
          <div className="guard-apt">
            {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt : ''}
          </div>
          <div className="guard-name">{req.createdByName}</div>
          <div className="guard-cat">{CAT_LABEL[req.category] || req.category}</div>
        </div>
        <div className={'guard-tech-status ' + req.status}>
          {req.status === 'pending' ? 'Новая' : req.status === 'accepted' ? 'В работе' : 'Готово'}
        </div>
      </div>

      {req.comment && (
        <div className="guard-details">
          <div className="guard-detail"><span className="guard-detail-lbl">Описание</span><span className="guard-detail-val">{req.comment}</span></div>
        </div>
      )}

      <div className="guard-actions">
        {req.status === 'pending' && (
          <button className="guard-btn approve" onClick={doAccept} disabled={!!loading}>
            {loading === 'accept' ? <span className="btn-spin" /> : <AppIcon name="tools" size={14} />}
            <span>Принять в работу</span>
          </button>
        )}
        {residentPhone && (
          <a href={'tel:' + residentPhone.replace(/\s/g, '')} className="guard-btn call">
            <AppIcon name="phone" size={14} /> <span>Позвонить жильцу</span>
          </a>
        )}
      </div>
    </div>
  );
});

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function GuardPostMode({ user, onViewDetails }) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { users } = useUsers();
  const [subTab, setSubTab] = useState('active');
  const [showScan, setShowScan] = useState(false);

  const pending  = useMemo(() => sortReqs(requests.filter(r => r.type === 'pass' && r.status === 'pending')), [requests]);
  const approved = useMemo(() => sortReqs(requests.filter(r => r.type === 'pass' && r.status === 'approved' && r.passDuration !== 'temporary')), [requests]);
  const temporary = useMemo(() => {
    // FIX [PERF]: pre-compute timestamps — new Date() в компараторе = O(n log n) аллокаций
    const filtered = requests.filter(r =>
      r.type === 'pass' && r.passDuration === 'temporary' && r.validUntil &&
      (r.status === 'approved' || r.status === 'arrived')
    );
    const withTs = filtered.map(r => ({ r, ts: new Date(r.validUntil).getTime() }));
    withTs.sort((a, b) => a.ts - b.ts);
    return withTs.map(({ r }) => r);
  }, [requests]);
  const techPending  = useMemo(() => sortReqs(requests.filter(r => r.type === 'tech' && r.status === 'pending')), [requests]);
  const techActive   = useMemo(() => sortReqs(requests.filter(r => r.type === 'tech' && (r.status === 'pending' || r.status === 'accepted'))), [requests]);
  // FIX [PERF]: techActive.filter вызывался 3 раза в render — мемоизируем подмножества
  const techPendingCards   = useMemo(() => techActive.filter(r => r.status === 'pending'),  [techActive]);
  const techAcceptedCards  = useMemo(() => techActive.filter(r => r.status === 'accepted'), [techActive]);

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

      {/* Подвкладки */}
      <div className="guard-subtabs">
        <button className={'guard-subtab' + (subTab === 'active' ? ' active' : '')} onClick={() => setSubTab('active')}>
          <span className="u-inline-icon"><AppIcon name="shield" size={14} /></span> Активные
          {(pending.length + approved.length) > 0 && <span className="guard-subtab-badge">{pending.length + approved.length}</span>}
        </button>
        <button className={'guard-subtab' + (subTab === 'temp' ? ' active' : '')} onClick={() => setSubTab('temp')}>
          <span className="u-inline-icon"><AppIcon name="history" size={14} /></span> Временные
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
            <div className="guard-empty">
              <div className="guard-empty-icon"><AppIcon name="shield" size={42} /></div>
              <div style={{ fontSize: 18, color: 'var(--t3)', marginBottom: 8 }}>Всё спокойно</div>
              <div style={{ fontSize: 13, color: 'var(--t4)' }}>Нет активных пропусков</div>
            </div>
          )}
          <GuardSection title="Ожидают решения" icon={<AppIcon name="history" size={14} />} count={pending.length}>
            {pending.map(r => (
              <ErrorBoundary key={r.id} name={`Карточка ${r.id}`}>
                <GuardCard req={r} userName={user.name} blacklist={blacklist} residentPhone={getPhone(r.createdByUid)} onViewDetails={onViewDetails} />
              </ErrorBoundary>
            ))}
          </GuardSection>
          <GuardSection title="Допущены" icon={<AppIcon name="list" size={14} />} count={approved.length}>
            {approved.map(r => (
              <ErrorBoundary key={r.id} name={`Карточка ${r.id}`}>
                <GuardCard req={r} userName={user.name} blacklist={blacklist} residentPhone={getPhone(r.createdByUid)} onViewDetails={onViewDetails} />
              </ErrorBoundary>
            ))}
          </GuardSection>
        </>
      )}

      {/* Временные */}
      {subTab === 'temp' && (
        <>
          {temporary.length === 0 && (
            <div className="guard-empty">
              <div className="guard-empty-icon"><AppIcon name="history" size={42} /></div>
              <div style={{ fontSize: 18, color: 'var(--t3)', marginBottom: 8 }}>Нет временных пропусков</div>
              <div style={{ fontSize: 13, color: 'var(--t4)' }}>Временные пропуска с открытым доступом появятся здесь</div>
            </div>
          )}
          <div className="guard-list">
            {temporary.map(r => (
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
            <div className="guard-empty">
              <div className="guard-empty-icon"><AppIcon name="tools" size={42} /></div>
              <div style={{ fontSize: 18, color: 'var(--t3)', marginBottom: 8 }}>Нет техзаявок</div>
              <div style={{ fontSize: 13, color: 'var(--t4)' }}>Заявки на электрика и сантехника появятся здесь</div>
            </div>
          )}
          <GuardSection title="Новые заявки" icon={<AppIcon name="history" size={14} />} count={techPending.length}>
            {techPendingCards.map(r => (
              <ErrorBoundary key={r.id} name={`Техзаявка ${r.id}`}>
                <TechCard req={r} userName={user.name} residentPhone={getPhone(r.createdByUid)} />
              </ErrorBoundary>
            ))}
          </GuardSection>
          <GuardSection title="В работе" icon={<AppIcon name="tools" size={14} />} count={techAcceptedCards.length}>
            {techAcceptedCards.map(r => (
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
