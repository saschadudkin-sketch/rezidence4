/**
 * views/guard/TempPassCard.jsx — T-05: extracted from GuardPostMode.jsx
 * Строка временного пропуска.
 */

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

// FIX [PERF-5]: memo — TempPassCard рендерится для каждого временного пропуска.
const TempPassCard = memo(function TempPassCard({ req, userName, residentPhone, blacklist }) {
  const { arriveRequest } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading] = useState(false);
  const blMatch = checkBlacklist(req, blacklist);

  // FIX [PERF]: useMemo — exp/diff пересчитываются только при смене req.validUntil
  const { expired, timeLeft, diff } = useMemo(() => {
    const exp  = new Date(req.validUntil);
    const diff = exp.getTime() - Date.now();
    const expired = diff <= 0;
    const days  = Math.floor(diff / MS_PER_DAY);
    const hours = Math.floor((diff % MS_PER_DAY) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const timeLeft = expired ? 'Истёк'
      : days > 0 ? `${days}д ${hours}ч`
      : hours > 0 ? `${hours}ч ${mins}мин`
      : `${mins}мин`;
    return { expired, timeLeft, diff };
  }, [req.validUntil]);

  // FE-02: useIsMounted заменяет inline isMountedRef-паттерн
  const isMountedRef = useIsMounted();

  const doArrive = async () => {
    if (loading) return;
    setLoading(true);
    try {
      arriveRequest(req.id, userName, 'security');
      if (isMountedRef.current) toast('Вход отмечен', 'success');
    } catch {
      if (isMountedRef.current) toast(presentError(new Error('arrive_failed'), 'default').message, 'error');
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

export default TempPassCard;
