/**
 * views/guard/GuardCard.jsx — T-05: extracted from GuardPostMode.jsx
 * Карточка одного пропуска на посту охраны.
 */

import { useState, useRef, useCallback, memo } from 'react';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useActions, useAvatar } from '../../store/AppStore';
import { CAT_LABEL } from '../../constants/index';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { PassQRModal } from '../../requests/PassQRModal';
import { checkBlacklist } from '../../store/slices/blacklistSlice';
import { toast } from '../../ui/Toasts';
import { pushNotifyResident } from '../../services/pushNotification';
import { sendNotif } from '../../utils';
import { logVisit } from '../../shared/api/passesApi';
import { AppIcon } from '../../ui/AppIcon';
import { presentError } from '../../ui/errorPresenter';

// FIX [PERF-5]: memo — GuardCard рендерится для каждой заявки в списке.
// Без memo перерендер при любом изменении requests (например, SSE-обновление одной карточки)
// вызывал полный ре-рендер ВСЕХ видимых GuardCard включая useAvatar/useActions хуки.
const GuardCard = memo(function GuardCard({ req, userName, blacklist, residentPhone, onViewDetails }) {
  const { approveRequest, rejectRequest, arriveRequest, approveAndArrive } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading]   = useState(null);
  const [showQR, setShowQR]     = useState(false);
  // CQ-01: два boolean → один enum — исключает невалидное состояние confirmApprove && confirmReject
  const [confirmAction, setConfirmAction] = useState(null); // null | 'approve' | 'reject'
  const blMatch = checkBlacklist(req, blacklist);

  const handleInfoTap = () => {
    if (!onViewDetails) return;
    onViewDetails(req.id);
  };

  // FE-02: useIsMounted заменяет inline isMountedRef-паттерн
  const isMountedRef = useIsMounted();

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
      if (isMountedRef.current) toast(presentError(e, 'default').message, 'error');
    } finally {
      if (isMountedRef.current) setLoading(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isMountedRef is a stable ref object, read at call time not captured in closure
  }, []);

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
    setConfirmAction(null);
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
        <div
          className={'guard-info ' + (onViewDetails ? 'req-head req-head--clickable' : 'req-head')}
          onClick={handleInfoTap}
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
        <button className="qr-pass-btn u-mb0" onClick={() => setShowQR(true)}>
          <span className="u-inline-icon"><AppIcon name="phone" size={18} /></span>
          <div><div className="u-fs13 u-fw500 u-t1">Показать QR-код</div></div>
        </button>
      )}
      {showQR && <PassQRModal req={req} onClose={() => setShowQR(false)} />}

      {(req.photos?.length > 0 || req.photo) && (
        <div className="guard-photos">
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
            {confirmAction === 'approve' ? (
              <button className="guard-btn approve confirm" onClick={doPass} disabled={!!loading}>
                {loading === 'approve' ? <span className="btn-spin" /> : <AppIcon name="check" size={14} />}
                <span>Точно пропустить?</span>
              </button>
            ) : (
              <button className="guard-btn approve" onClick={() => setConfirmAction('approve')} disabled={!!loading}>
                <span className="u-inline-icon"><AppIcon name="check" size={14} /></span><span>Пропустить</span>
              </button>
            )}
            {confirmAction === 'reject' ? (
              <button className="guard-btn reject confirm" onClick={doReject} disabled={!!loading}>
                {loading === 'reject' ? <span className="btn-spin" /> : <AppIcon name="denied" size={14} />}
                <span>Точно отказать?</span>
              </button>
            ) : (
              <button className="guard-btn reject" onClick={() => setConfirmAction('reject')} disabled={!!loading}>
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
        {residentPhone && (
          <a href={'tel:' + residentPhone.replace(/\s/g, '')} className="guard-btn call">
            <AppIcon name="phone" size={14} /> <span>Позвонить жильцу</span>
          </a>
        )}
      </div>
    </div>
  );
});

export default GuardCard;
