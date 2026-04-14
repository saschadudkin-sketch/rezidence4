import { useState, useMemo, memo } from 'react';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useActions, useAvatar } from '../../store/AppStore';
import { CAT_LABEL } from '../../constants/index';
import { checkBlacklist } from '../../store/slices/blacklistSlice';
import { toast } from '../../ui/Toasts';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';
import { MS_PER_DAY } from '../../constants/limits';
import { presentError } from '../../ui/errorPresenter';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { BlacklistEntry } from '../../store/slices/blacklistSlice';
import type { UserRole } from '../../store/slices/usersSlice';

type TempPassCardProps = {
  req: AppRequest;
  userName: string;
  residentPhone?: string | null;
  blacklist: BlacklistEntry[];
};

const getCategoryLabel = (category?: string) => (
  category && category in CAT_LABEL
    ? CAT_LABEL[category as keyof typeof CAT_LABEL]
    : category ?? ''
);

const TempPassCard = memo(function TempPassCard({ req, userName, residentPhone, blacklist }: TempPassCardProps) {
  const { arriveRequest, approveAndArrive, rejectRequest } = useActions();
  const avData = useAvatar(req.createdByUid ?? '');
  const [loading, setLoading] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const blMatch = checkBlacklist(req, blacklist);

  const { expired, timeLeft, diff } = useMemo(() => {
    const validUntil = req.validUntil ? new Date(req.validUntil) : null;
    if (!validUntil) return { expired: true, timeLeft: 'Истёк', diff: -1 };

    const diffMs = validUntil.getTime() - Date.now();
    const isExpired = diffMs <= 0;
    const days = Math.floor(diffMs / MS_PER_DAY);
    const hours = Math.floor((diffMs % MS_PER_DAY) / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    const nextLabel = isExpired
      ? 'Истёк'
      : days > 0 ? `${days}д ${hours}ч`
      : hours > 0 ? `${hours}ч ${mins}мин`
      : `${mins}мин`;

    return { expired: isExpired, timeLeft: nextLabel, diff: diffMs };
  }, [req.validUntil]);

  const isMountedRef = useIsMounted();

  const doArrive = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (req.status === 'pending') {
        await Promise.resolve(approveAndArrive(req.id, userName, 'security'));
      } else {
        await Promise.resolve(arriveRequest(req.id, userName, 'security'));
      }
      if (isMountedRef.current) toast('Вход отмечен', 'success');
    } catch {
      if (isMountedRef.current) toast(presentError(new Error('arrive_failed'), 'default').message, 'error');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const doReject = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await Promise.resolve(rejectRequest(req.id, userName, 'security'));
      if (isMountedRef.current) toast('В пропуске отказано', 'error');
    } catch {
      if (isMountedRef.current) toast(presentError(new Error('reject_failed'), 'default').message, 'error');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setConfirmReject(false);
      }
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
          <AvatarCircle avData={avData} role={req.createdByRole as UserRole | undefined} name={req.createdByName || '?'} size={42} fontSize={16} />
        </div>
        <div className="guard-info">
          <div className="guard-apt">
            {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt : ''}
          </div>
          <div className="guard-name">{req.createdByName}</div>
          <div className="guard-cat">{req.visitorName || getCategoryLabel(req.category)}</div>
        </div>
        <div className={'guard-temp-expiry' + (expired ? ' expired' : diff < 3_600_000 ? ' soon' : '')}>
          <span className="u-inline-icon">
            <AppIcon name={expired ? 'denied' : diff < 3_600_000 ? 'alert' : 'history'} size={13} />
          </span>{' '}
          {timeLeft}
        </div>
      </div>

      {(req.status === 'approved' || req.status === 'pending') && !expired && (
        <div className="guard-actions">
          <button className="guard-btn arrive" onClick={doArrive} disabled={loading}>
            {loading ? <span className="btn-spin" /> : <AppIcon name="door" size={14} />}
            <span>Отметить вход</span>
          </button>
          {confirmReject ? (
            <button className="guard-btn reject confirm" onClick={doReject} disabled={loading}>
              {loading ? <span className="btn-spin" /> : <AppIcon name="denied" size={14} />}
              <span>Точно отказать?</span>
            </button>
          ) : (
            <button className="guard-btn reject" onClick={() => setConfirmReject(true)} disabled={loading}>
              <span className="u-inline-icon"><AppIcon name="close" size={14} /></span><span>Отказать</span>
            </button>
          )}
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

export default TempPassCard;
