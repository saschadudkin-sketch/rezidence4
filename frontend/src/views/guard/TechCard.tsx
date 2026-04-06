/**
 * views/guard/TechCard.jsx — T-05: extracted from GuardPostMode.jsx
 * Карточка технической заявки на посту охраны.
 */

import { useState, useRef, useCallback, memo } from 'react';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useActions, useAvatar } from '../../store/AppStore';
import { CAT_LABEL } from '../../constants/index';
import { toast } from '../../ui/Toasts';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';

// FIX [PERF-5]: memo — аналогично TempPassCard
const TechCard = memo(function TechCard({ req, userName, residentPhone }) {
  const { acceptRequest } = useActions();
  const avData = useAvatar(req.createdByUid);
  const [loading, setLoading] = useState(null);

  // FE-02: useIsMounted заменяет inline isMountedRef-паттерн
  const isMountedRef = useIsMounted();
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const doAccept = useCallback(async () => {
    if (loadingRef.current) return;
    if (!isMountedRef.current) return;
    setLoading('accept');
    try {
      acceptRequest(req.id, userName, 'security');
      if (isMountedRef.current) toast('Принято в работу', 'success');
    } catch {
      if (isMountedRef.current) toast('Ошибка', 'error');
    } finally {
      if (isMountedRef.current) setLoading(null);
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

export default TechCard;
