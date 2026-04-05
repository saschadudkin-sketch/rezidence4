import { useState, useEffect, useRef } from 'react';
import { useActions } from '../store/AppStore';
import { CAT_ICON, CAT_LABEL } from '../constants/index';
import { toastBySyncResult } from '../ui/syncFeedback';
import { toast } from '../ui/Toasts';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { services } from '../services/providers/serviceContainer';
import { AppIcon } from '../ui/AppIcon';

export function EditRequestModal({ req, onClose, onDone }) {
  const [vName,    setVName]    = useState(req.visitorName  || '');
  const [vPhone,   setVPhone]   = useState(req.visitorPhone || '');
  const [carPlate, setCarPlate] = useState(req.carPlate     || '');
  const [comment,  setComment]  = useState(req.comment      || '');
  const [loading,  setLoading]  = useState(false);
  const { updateRequest } = useActions();

  // FIX [BUG-22]: isMountedRef — если пользователь закрыл модал пока запрос летел,
  // setLoading(false) вызывался на размонтированном компоненте.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    lockScroll();
    return () => {
      isMountedRef.current = false;
      unlockScroll();
    };
  }, []);

  const save = async () => {
    setLoading(true);
    const patch = {
      visitorName:  vName.trim()    || null,
      visitorPhone: vPhone.trim()   || null,
      carPlate:     carPlate.trim() || null,
      comment:      comment.trim(),
    };
    try {
      const mode = await services.requests.updateEverywhere({ requestId: req.id, patch, updateLocal: updateRequest });
      if (!isMountedRef.current) return;
      toastBySyncResult(mode, 'Заявка обновлена', 'Изменения сохранены локально. Синхронизация будет повторена позже');
      onDone();
      onClose();
    } catch (e) {
      console.warn('[EditRequestModal] save failed:', e);
      if (isMountedRef.current) toast('Не удалось сохранить изменения', 'error');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const needsPlate = ['taxi', 'car', 'master', 'delivery'].includes(req.category);

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-head">
          <div>
            <span className="modal-title">Редактировать заявку</span>
            <div style={{ fontSize: 11, color: 'var(--g2)', marginTop: 2 }}>
              <span className="u-inline-icon"><AppIcon name={CAT_ICON[req.category] || 'users'} size={12} /> {CAT_LABEL[req.category]}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          {req.type === 'pass' && req.category !== 'taxi' && (
            <div className="field">
              <label className="field-lbl">{req.category === 'team' ? 'Имена посетителей' : 'Имя посетителя'}</label>
              <input className="field-inp" value={vName} onChange={e => setVName(e.target.value)} autoCapitalize="words" />
            </div>
          )}
          {req.type === 'pass' && req.category !== 'taxi' && req.category !== 'team' && (
            <div className="field">
              <label className="field-lbl">Телефон</label>
              <input className="field-inp" value={vPhone} onChange={e => setVPhone(e.target.value)} type="tel" inputMode="tel" />
            </div>
          )}
          {req.type === 'pass' && req.category === 'taxi' && (
            <div className="field">
              <label className="field-lbl">Марка и номер авто</label>
              <input className="field-inp" value={carPlate} onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
            </div>
          )}
          {req.type === 'pass' && needsPlate && req.category !== 'taxi' && (
            <div className="field">
              <label className="field-lbl">Марка и номер авто</label>
              <input className="field-inp" value={carPlate} onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
            </div>
          )}
          <div className="field">
            <label className="field-lbl">Комментарий</label>
            <textarea className="field-textarea" rows={3} value={comment} onChange={e => setComment(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={save} disabled={loading}>
            <span>{loading ? 'Сохранение...' : 'Сохранить'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
