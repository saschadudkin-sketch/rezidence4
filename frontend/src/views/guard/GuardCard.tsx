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
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { BlacklistEntry } from '../../store/slices/blacklistSlice';
import type { UserRole } from '../../store/slices/usersSlice';

type GuardActionType = 'approve' | 'reject' | 'arrive';
type ConfirmAction = 'approve' | 'reject' | null;
type ToastType = 'success' | 'error';
type GuardCardProps = {
  req: AppRequest;
  userName: string;
  blacklist: BlacklistEntry[];
  residentPhone?: string | null;
  onViewDetails?: (reqId: string) => void;
};

const getCategoryLabel = (category?: string) => (
  category && category in CAT_LABEL
    ? CAT_LABEL[category as keyof typeof CAT_LABEL]
    : category ?? ''
);

const GuardCard = memo(function GuardCard({ req, userName, blacklist, residentPhone, onViewDetails }: GuardCardProps) {
  const { rejectRequest, arriveRequest, approveAndArrive } = useActions();
  const avData = useAvatar(req.createdByUid ?? '');
  const [loading, setLoading] = useState<GuardActionType | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const blMatch = checkBlacklist(req, blacklist);
  const isBlacklisted = Boolean(blMatch);

  const handleInfoTap = () => {
    onViewDetails?.(req.id);
  };

  const isMountedRef = useIsMounted();
  const loadingRef = useRef<GuardActionType | null>(loading);
  loadingRef.current = loading;

  const act = useCallback(async (
    key: GuardActionType,
    fn: () => Promise<void>,
    msg: string,
    type: ToastType,
  ) => {
    if (loadingRef.current || !isMountedRef.current) return;
    setLoading(key);
    try {
      await fn();
      if (isMountedRef.current) toast(msg, type);
    } catch (error) {
      console.warn('[GuardCard] action error:', error);
      if (isMountedRef.current) toast(presentError(error, 'default').message, 'error');
    } finally {
      if (isMountedRef.current) setLoading(null);
    }
  }, [isMountedRef]);

  const notifyEntry = {
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
  } as const;

  const doPass = () => {
    setConfirmAction(null);
    if (req.passDuration === 'once' || !req.passDuration) {
      void act('approve', async () => {
        await Promise.resolve(approveAndArrive(req.id, userName, 'security'));
        pushNotifyResident(req);
        await logVisit(notifyEntry).catch(() => {});
      }, 'Вход отмечен', 'success');
      return;
    }

    void act('approve', async () => {
      await Promise.resolve(approveAndArrive(req.id, userName, 'security'));
      sendNotif('Вход отмечен', `${req.visitorName || 'Гость'} — вход отмечен охраной`, 'status-' + req.id);
    }, 'Вход отмечен', 'success');
  };

  const doReject = () => {
    void act('reject', async () => {
      await Promise.resolve(rejectRequest(req.id, userName, 'security'));
      sendNotif('В допуске отказано', `${req.visitorName || 'Гость'} — охрана отклонила заявку`, 'status-' + req.id);
    }, 'В пропуске отказано', 'error');
    setConfirmAction(null);
  };

  const doArrive = () => void act('arrive', async () => {
    await Promise.resolve(arriveRequest(req.id, userName, 'security'));
    pushNotifyResident(req);
    await logVisit(notifyEntry);
  }, 'Вход отмечен', 'success');

  const photoList = req.photos && req.photos.length > 0
    ? req.photos
    : req.photo ? [req.photo] : [];

  return (
    <div className={'guard-card' + (isBlacklisted ? ' bl-flagged' : '')} role="article">
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
          <AvatarCircle avData={avData} role={req.createdByRole as UserRole | undefined} name={req.createdByName || '?'} size={48} fontSize={18} />
        </div>
        <div
          className={'guard-info ' + (onViewDetails ? 'req-head req-head--clickable' : 'req-head')}
          onClick={handleInfoTap}
          role={onViewDetails ? 'button' : undefined}
          tabIndex={onViewDetails ? 0 : undefined}
          aria-label={onViewDetails ? 'Подробнее о заявке' : undefined}
          onKeyDown={onViewDetails ? (event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), handleInfoTap()) : undefined}
        >
          <div className="guard-apt">
            {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt : ''}
          </div>
          <div className="guard-name">{req.createdByName}</div>
          <div className="guard-cat">{getCategoryLabel(req.category)}</div>
        </div>
        {onViewDetails && (
          <button className="guard-detail-btn" onClick={() => onViewDetails(req.id)} title="Подробнее">
            <AppIcon name="info" size={14} />
          </button>
        )}
      </div>

      {(req.visitorName || req.carPlate || req.comment) && (
        <div className="guard-details">
          {req.carPlate && (
            <div className="guard-plate-block">
              <span className="guard-plate-label">Авто</span>
              <span className="guard-plate-value">{req.carPlate}</span>
            </div>
          )}
          {req.visitorName && <div className="guard-detail"><span className="guard-detail-lbl">Гость</span><span className="guard-detail-val">{req.visitorName}</span></div>}
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

      {photoList.length > 0 && (
        <div className="guard-photos">
          {photoList.slice(0, 3).map((src, index) => (
            <a key={index} href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt="фото" className="guard-photo-thumb" />
            </a>
          ))}
        </div>
      )}

      <div className="guard-actions">
        {req.status === 'pending' && (
          <>
            {isBlacklisted ? (
              <>
                {confirmAction === 'reject' ? (
                  <button className="guard-btn reject confirm" onClick={doReject} disabled={!!loading}>
                    {loading === 'reject' ? <span className="btn-spin" /> : <AppIcon name="denied" size={14} />}
                    <span>Подтвердить отказ</span>
                  </button>
                ) : (
                  <button className="guard-btn reject guard-btn--primary-risk" onClick={() => setConfirmAction('reject')} disabled={!!loading}>
                    <span className="u-inline-icon"><AppIcon name="close" size={14} /></span><span>Отказать</span>
                  </button>
                )}
                {confirmAction === 'approve' ? (
                  <button className="guard-btn override confirm" onClick={doPass} disabled={!!loading}>
                    {loading === 'approve' ? <span className="btn-spin" /> : <AppIcon name="alert" size={14} />}
                    <span>Отметить вход вопреки стоп-листу?</span>
                  </button>
                ) : (
                  <button className="guard-btn override" onClick={() => setConfirmAction('approve')} disabled={!!loading}>
                    <span className="u-inline-icon"><AppIcon name="alert" size={14} /></span><span>Отметить вход вручную</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="guard-btn approve" onClick={doPass} disabled={!!loading}>
                  {loading === 'approve' ? <span className="btn-spin" /> : <span className="u-inline-icon"><AppIcon name="check" size={14} /></span>}
                  <span>Отметить вход</span>
                </button>
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
          </>
        )}
        {req.status === 'approved' && (req.passDuration === 'once' || !req.passDuration) && (
          <>
            {isBlacklisted ? (
              <>
                {confirmAction === 'reject' ? (
                  <button className="guard-btn reject confirm" onClick={doReject} disabled={!!loading}>
                    {loading === 'reject' ? <span className="btn-spin" /> : <AppIcon name="denied" size={14} />}
                    <span>Подтвердить отказ</span>
                  </button>
                ) : (
                  <button className="guard-btn reject guard-btn--primary-risk" onClick={() => setConfirmAction('reject')} disabled={!!loading}>
                    <span className="u-inline-icon"><AppIcon name="close" size={14} /></span><span>Отказать</span>
                  </button>
                )}
                {confirmAction === 'approve' ? (
                  <button className="guard-btn override confirm" onClick={doArrive} disabled={!!loading}>
                    {loading === 'arrive' ? <span className="btn-spin" /> : <AppIcon name="alert" size={14} />}
                    <span>Отметить вход вопреки стоп-листу?</span>
                  </button>
                ) : (
                  <button className="guard-btn override" onClick={() => setConfirmAction('approve')} disabled={!!loading}>
                    <span className="u-inline-icon"><AppIcon name="alert" size={14} /></span><span>Отметить вход вручную</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="guard-btn arrive" onClick={doArrive} disabled={!!loading}>
                  {loading === 'arrive' ? <span className="btn-spin" /> : <AppIcon name="door" size={14} />}
                  <span>Отметить вход</span>
                </button>
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
          </>
        )}
        {req.status === 'approved' && (req.passDuration === 'permanent' || req.passDuration === 'temporary') && (
          <>
            <button className="guard-btn arrive" onClick={doArrive} disabled={!!loading}>
              {loading === 'arrive' ? <span className="btn-spin" /> : <AppIcon name="door" size={14} />}
              <span>Отметить вход</span>
            </button>
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
