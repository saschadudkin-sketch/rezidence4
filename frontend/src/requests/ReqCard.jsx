import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { toast } from '../ui/Toasts';
import { PassQRModal } from './PassQRModal';
import {
  useActions, useAvatar,
  useRequestHistory as useReqHistory,
} from '../store/AppStore.jsx';
import { CAT_LABEL, STS_LABEL, ROLE_LABELS, PASS_DURATION_LABEL, PASS_DURATION_ICON } from '../constants/index.js';
import {
  canApproveRequest as canApproveByRole,
  canRejectRequest as canRejectByRole,
  canAcceptRequest as canAcceptByRole,
  canMarkArrival as canMarkArrivalByRole,
} from '../domain/permissions';
import {
  isActiveRequest, isPendingRequest,
  isApprovedRequest, isScheduledRequest,
  canManageRequests, canApproveRequests, shouldShowActions,
} from '../constants/requestPredicates';
import { fmtDate, fmtTime, groupReqs } from '../utils.js';
import { AvatarCircle } from '../ui/AvatarCircle.jsx';
import { PhotoLightbox } from '../ui/PhotoLightbox.jsx';
import { AppIcon } from '../ui/AppIcon.jsx';

// ─── Toast (глобальный синглтон) ────────────────────────────────────────────


// ─── ReqPhoto ────────────────────────────────────────────────────────────────

// FIX [PERF-5]: memo — ReqPhoto рендерится для каждого фото в карточке.
// Без memo при раскрытии/закрытии любой другой карточки все фото перерисовывались.
const ReqPhoto = memo(function ReqPhoto({ src }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={src} alt="фото"
        style={{ maxWidth: 220, maxHeight: 200, objectFit: 'contain',
          background: 'var(--s1)', borderRadius: 8,
          cursor: 'zoom-in', display: 'block' }}
        onClick={() => setOpen(true)}
      />
      {open && <PhotoLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
});

// FIX [BUG-6]: нестабильный ключ `src.slice(-20) + i` — если URL перезапишется
// (например, при обновлении через SSE), React может неправильно сопоставить
// компоненты и вызвать полный unmount/mount вместо обновления.
// Используем стабильный индекс: порядок фото в массиве не меняется без замены всего req.
// FIX [MEMO]: ReqPhotos без memo перерисовывался при любом изменении статуса заявки
// (например, при hover/expand другой карточки если ReqCard в общем списке).
const ReqPhotos = memo(function ReqPhotos({ req }) {
  const photos = req.photos && req.photos.length > 0 ? req.photos : req.photo ? [req.photo] : [];
  if (photos.length === 0) return null;
  return (
    <div className="req-photos-grid">
      {photos.map((src, i) => <ReqPhoto key={i} src={src} />)}
    </div>
  );
});

// ─── ReqSkeleton ─────────────────────────────────────────────────────────────

export function ReqSkeleton({ count = 3 }) {
  return (
    <div className="req-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card"
          style={{ '--card-delay': (i * 80) + 'ms', animationDelay: (i * 80) + 'ms' }}>
          <div className="skeleton-row">
            <div className="skeleton-avatar" />
            <div className="skeleton-lines">
              <div className="skeleton-bar wide" />
              <div className="skeleton-bar mid" />
            </div>
            <div className="u-col-end-g6">
              <div className="skeleton-bar narrow" style={{ width: 48 }} />
              <div className="skeleton-bar narrow" style={{ width: 64 }} />
            </div>
          </div>
          <div className="skeleton-bar" style={{ width: '80%', marginTop: 2 }} />
        </div>
      ))}
    </div>
  );
}

// ─── ReqCard ─────────────────────────────────────────────────────────────────

// FIX [PERF-12]: memo — ReqCard рендерится для каждой заявки в GroupedReqList.
// При обновлении любого состояния родителя (например, открытие модала) без memo
// перерендерились ВСЕ карточки, включая тяжёлые вычисления mayApprove/mayReject
// и вызовы useAvatar / useReqHistory для каждой из них.
// Именованный экспорт сохраняем через отдельную переменную.
export const ReqCard = memo(function ReqCard({ req, userRole, userName, userId, staggerIdx = 0, onRepeat, onEdit, onDelete, onCancel, highlightId, onHighlighted }) {
  const isStaffRole = canManageRequests(userRole);
  const isActive = isActiveRequest(req);
  const [actLoading, setActLoading] = useState(null);
  const isHighlighted = highlightId === req.id;
  const isCancellable = onCancel && (req.status === 'pending' || req.status === 'approved');
  const [expanded, setExpanded] = useState((isStaffRole && isActive) || isHighlighted || isCancellable);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showQR,    setShowQR]    = useState(false);
  const cardRef = useRef(null);
  const history = useReqHistory(req.id);
  const { approveRequest, rejectRequest, acceptRequest, arriveRequest } = useActions();
  const avData = useAvatar(req.createdByUid);
  // FIX [PERF]: actor object + permission checks мемоизированы —
  // пересчитываются только при изменении req.status или userRole/userId
  const { mayApprove, mayReject, mayAccept, mayMarkArrival } = useMemo(() => {
    const actor = { role: userRole, uid: userId };
    return {
      mayApprove:    canApproveByRole(actor, req),
      mayReject:     canRejectByRole(actor, req),
      mayAccept:     canAcceptByRole(actor, req),
      mayMarkArrival: canMarkArrivalByRole(actor, req),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on specific req fields only
  }, [req.status, userRole, userId]);

  // Auto-expand and scroll when highlighted
  useEffect(() => {
    if (!isHighlighted || !cardRef.current) return;

    setExpanded(true);

    const t1 = setTimeout(() => {
      if (!cardRef.current) return;
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardRef.current.classList.add('req-card-highlight');
    }, 100);

    const t2 = setTimeout(() => {
      cardRef.current?.classList.remove('req-card-highlight');
      onHighlighted?.();
    }, 2100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isHighlighted, onHighlighted]);

  const actorName = userName || userRole;

  // FIX [BUG-1]: Три проблемы были в оригинальном act():
  //   а) stale closure: actLoading захватывался в deps useCallback и пересоздавал
  //      функцию при каждом setActLoading → каскадное пересоздание doApprove/doReject/…
  //   б) setTimeout без cleanup → setState вызывался на unmounted компоненте
  //      (предупреждение React "Can't perform a state update on unmounted component")
  //   в) искусственная задержка 350мс без пользы для UX
  //
  // РЕШЕНИЕ:
  //   - actLoadingRef читается в момент вызова → нет stale closure, нет deps
  //   - isMounted ref защищает setState после unmount
  //   - прямой async/await вместо setTimeout
  const actLoadingRef = useRef(actLoading);
  actLoadingRef.current = actLoading;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const act = useCallback(async (key, fn, msg, type) => {
    if (actLoadingRef.current) return;
    if (!isMountedRef.current) return;
    setActLoading(key);
    try {
      await fn();
      if (isMountedRef.current) toast(msg, type);
    } catch (e) {
      if (isMountedRef.current) toast('Ошибка операции', 'error');
    } finally {
      if (isMountedRef.current) setActLoading(null);
    }
  }, []); // стабильный — читает ref в момент вызова

  const doApprove = useCallback(() => act('approve', () => approveRequest(req.id, actorName, userRole), 'Допуск предоставлен', 'success'), [act, approveRequest, req.id, actorName, userRole]);
  const doReject  = useCallback(() => act('reject',  () => rejectRequest(req.id, actorName, userRole),  'В допуске отказано', 'error'),   [act, rejectRequest,  req.id, actorName, userRole]);
  const doAccept  = useCallback(() => act('accept',  () => acceptRequest(req.id, actorName, userRole),  'Заявка принята в работу', 'success'), [act, acceptRequest, req.id, actorName, userRole]);
  const doArrive  = useCallback(() => act('arrive',  () => arriveRequest(req.id, actorName, userRole),  'Отмечен вход на территорию', 'success'), [act, arriveRequest, req.id, actorName, userRole]);

  const hasDetails = !!(req.arrivedAt || req.visitorName || req.carPlate || req.visitorPhone || req.comment || req.photo || (req.photos && req.photos.length) || history.length);
  const showActions = shouldShowActions(req, { userRole, onRepeat, onEdit, onDelete, onCancel });

  return (
    <div ref={cardRef} className={'req-card ' + req.status} style={{ '--card-delay': (staggerIdx * 45) + 'ms' }} role="article" aria-label={(req.visitorName || CAT_LABEL[req.category] || '') + ' — ' + (req.createdByName || '')}>
      <div className="req-head"
        onClick={() => (hasDetails || showActions) && setExpanded(o => !o)}
        style={{ cursor: (hasDetails || showActions) ? 'pointer' : 'default', marginBottom: 0 }}>
        <div className="req-left">
          <div className="req-ico" style={{ overflow: 'hidden', padding: 0 }}>
            <AvatarCircle avData={avData} role={req.createdByRole} name={req.createdByName || '?'} size={34} fontSize={13} />
          </div>
          <div className="u-mw0">
            <div className="req-cat">
              {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt + ' · ' : ''}
              {req.createdByName}
            </div>
            <div className="req-meta">
              <span className="u-inline-icon u-mr6" style={{ opacity: .7 }}>
                <AppIcon name={req.type === 'tech' ? 'tools' : 'ticket'} size={12} />
              </span>
              {CAT_LABEL[req.category] || req.category}
              {req.passDuration && req.passDuration !== 'once' && (
                <span className={'pass-dur-tag ' + req.passDuration}>{PASS_DURATION_ICON[req.passDuration]} {PASS_DURATION_LABEL[req.passDuration]}</span>
              )}
            </div>
          </div>
        </div>
        <div className="u-col-end-g4">
          <span style={{ fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap' }}>
            {/* FIX [PERF]: fmtDate вычисляется один раз, не трижды */}
            {(() => { const d = fmtDate(req.createdAt); return d + ((d === 'сегодня' || d === 'только что') ? ' ' + fmtTime(req.createdAt) : ''); })()}
          </span>
          <span className={'badge ' + req.status}>{STS_LABEL[req.status]}</span>
        </div>
      </div>

      {expanded && (<>
        {(req.arrivedAt || req.visitorName || req.carPlate || req.visitorPhone || req.comment) && (
          <div className="req-details">
            {req.arrivedAt    && <div><div className="det-lbl">Вход отмечен</div><div className="det-val u-arrived">{new Date(req.arrivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div></div>}
            {req.scheduledFor && isScheduledRequest(req) && <div style={{ gridColumn: '1/-1' }}><div className="det-lbl">Отправка запланирована</div><div className="det-val u-scheduled-t">{new Date(req.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div></div>}
            {req.passDuration && <div><div className="det-lbl">Тип пропуска</div><div className="det-val">{PASS_DURATION_ICON[req.passDuration]} {PASS_DURATION_LABEL[req.passDuration]}</div></div>}
            {req.validUntil   && <div><div className="det-lbl">Действует до</div><div className="det-val">{new Date(req.validUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>}
            {req.carPlate     && <div><div className="det-lbl">Авто</div><div className="det-val">{req.carPlate}</div></div>}
            {req.visitorName  && <div><div className="det-lbl">Посетитель</div><div className="det-val">{req.visitorName}</div></div>}
            {req.visitorPhone && <div><div className="det-lbl">Телефон</div><div className="det-val">{req.visitorPhone}</div></div>}
            {req.comment      && <div className="u-grid-span"><div className="det-lbl">Комментарий</div><div className="det-val">{req.comment}</div></div>}
            {history.length > 0 && (
              <div className="u-grid-span">
                <div className="det-lbl">История</div>
                {history.map((h, i) => (
                  // FIX [KEY]: h.at уникален per-event (timestamp); i — дополнительная
                  // защита от совпадения миллисекунд. Старый `${i}-${h.byRole}-${h.action}`
                  // не был стабильным при переупорядочивании.
                  // FIX [PERF]: inline style заменён на .req-history-row
                  <div key={`${h.at || i}-${i}`} className="req-history-row">
                    <span className="req-history-time">{fmtTime(h.at)}</span> · {h.action} · <span className="u-t4">{ROLE_LABELS[h.byRole] || h.byRole}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <ReqPhotos req={req} />

        {req.type === 'pass' && (req.status === 'approved' || req.status === 'pending') && (
          <button className="qr-pass-btn" onClick={() => setShowQR(true)}>
            <span className="u-inline-icon"><AppIcon name="phone" size={18} /></span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>QR-код пропуска</div>
              <div style={{ fontSize: 11, color: 'var(--t4)' }}>
                {req.status === 'approved' ? 'Покажите охране для прохода' : 'Будет активен после одобрения'}
              </div>
            </div>
          </button>
        )}

        {canApproveRequests(userRole) && (
          <div className="req-actions">
            {req.type === 'pass' ? <>
              {mayApprove && <button className="btn-yes"    onClick={doApprove} disabled={!!actLoading}>{actLoading === 'approve' && <span className="btn-spin" />}Разрешить</button>}
              {mayReject && <button className="btn-no"     onClick={doReject}  disabled={!!actLoading}>{actLoading === 'reject'  && <span className="btn-spin" />}Отказать</button>}
              {mayMarkArrival && isApprovedRequest(req) && <button className="btn-arrive" onClick={doArrive}  disabled={!!actLoading}>{actLoading === 'arrive'  && <span className="btn-spin" />}Отметить вход</button>}
              {req.status === 'rejected' && userRole === 'security' && <button className="btn-yes" onClick={doApprove} disabled={!!actLoading}>{actLoading === 'approve' && <span className="btn-spin" />}Разрешить</button>}
            </> : <>
              {mayAccept && req.status !== 'accepted' && <button className="btn-accept" onClick={doAccept} disabled={!!actLoading}>{actLoading === 'accept' && <span className="btn-spin" />}Принять заявку</button>}
            </>}
          </div>
        )}
        {onRepeat && req.status !== 'pending' && (
          <button className="tpl-save-btn" style={{ marginTop: 8, fontSize: 11 }} onClick={() => onRepeat(req)}>
            <span className="u-inline-icon u-mr6"><AppIcon name="undo" size={12} /></span>
            Повторить заявку
          </button>
        )}
        {(onEdit || onDelete) && isPendingRequest(req) && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            {confirmDel ? <>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>Удалить?</span>
              <button className="btn-del-sm" onClick={() => onDelete(req.id)}>Да</button>
              <button className="btn-outline" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setConfirmDel(false)}>Нет</button>
            </> : <>
              {onEdit && (
                <button className="btn-edit" onClick={() => onEdit(req)}>
                  <span className="u-inline-icon u-mr6"><AppIcon name="edit" size={12} /></span>
                  Редактировать
                </button>
              )}
              {onDelete && (
                <button className="btn-del-sm" onClick={() => setConfirmDel(true)}>
                  <span className="u-inline-icon u-mr6"><AppIcon name="trash" size={12} /></span>
                  Удалить
                </button>
              )}
            </>}
          </div>
        )}
        {onCancel && (req.status === 'pending' || req.status === 'approved') && !isStaffRole && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-outline" style={{ fontSize: 12, padding: '5px 12px', color: 'var(--err-t)', borderColor: 'var(--err)' }}
              onClick={() => onCancel(req.id)}>
              <span className="u-inline-icon u-mr6"><AppIcon name="close" size={12} /></span>
              Отменить заявку
            </button>
          </div>
        )}
      </>)}
      {showQR && <PassQRModal req={req} onClose={() => setShowQR(false)} />}
    </div>
  );
});

// ─── GroupedReqList ──────────────────────────────────────────────────────────

export function GroupedReqList({ reqs, userRole, userName, userId, onRepeat, onEdit, onDelete, onCancel }) {
  const groups = groupReqs(reqs);
  if (groups.length === 0) return null;
  const showHeaders = groups.length > 1 || (groups[0] && groups[0].label !== 'Сегодня');
  return (
    <div className="req-list">
      {groups.map(g => (
        <div key={g.label}>
          {showHeaders && <div className="group-date-label">{g.label}</div>}
          {g.items.map((r, i) => (
            <ReqCard key={r.id} req={r} staggerIdx={i} userRole={userRole} userName={userName} userId={userId}
              onRepeat={onRepeat}
              onEdit={onEdit}
              onDelete={onDelete}
              onCancel={onCancel}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
