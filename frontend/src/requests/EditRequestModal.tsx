import { useState, useEffect, useRef } from 'react';
import { useActions } from '../store/AppStore';
import { CAT_ICON, CAT_LABEL } from '../constants/index';
import { toastBySyncResult } from '../ui/syncFeedback';
import { toast } from '../ui/Toasts';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { services } from '../services/providers/serviceContainer';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';
import { sanitizeCarPlate, sanitizePhone, sanitizeText, validatePhone } from '../utils/inputSanitizer';
import type { AppRequest } from '../store/slices/requestsSlice';

type EditRequestModalProps = {
  req: AppRequest;
  onClose: () => void;
  onDone: () => void;
};

const getCategoryIcon = (category?: string): string =>
  (category ? CAT_ICON[category as keyof typeof CAT_ICON] : undefined) || 'users';

const getCategoryLabel = (category?: string): string =>
  (category ? CAT_LABEL[category as keyof typeof CAT_LABEL] : undefined) || '';

export function EditRequestModal({ req, onClose, onDone }: EditRequestModalProps) {
  const [vName, setVName] = useState(req.visitorName || '');
  const [vPhone, setVPhone] = useState(req.visitorPhone || '');
  const [carPlate, setCarPlate] = useState(req.carPlate || '');
  const [comment, setComment] = useState(req.comment || '');
  const [loading, setLoading] = useState(false);
  const { updateRequest } = useActions();
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

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
    const cleanName = sanitizeText(vName);
    const cleanPhone = sanitizePhone(vPhone);
    const cleanCarPlate = sanitizeCarPlate(carPlate);
    const cleanComment = sanitizeText(comment);
    const phoneErr = validatePhone(cleanPhone);
    if (phoneErr) {
      toast(phoneErr, 'error');
      return;
    }

    setLoading(true);
    const patch = {
      visitorName: cleanName || undefined,
      visitorPhone: cleanPhone || undefined,
      carPlate: cleanCarPlate || undefined,
      comment: cleanComment,
    };

    try {
      const mode = await services.requests.updateEverywhere({ requestId: req.id, patch, updateLocal: updateRequest });
      if (!isMountedRef.current) return;
      toastBySyncResult(mode, 'Заявка обновлена', 'Изменения сохранены локально. Синхронизация будет повторена позже');
      onDone();
      onClose();
    } catch (error) {
      console.warn('[EditRequestModal] save failed:', error);
      if (isMountedRef.current) toast('Не удалось сохранить изменения', 'error');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const category = req.category || '';
  const needsPlate = ['taxi', 'car', 'master', 'delivery'].includes(category);

  return (
    <div className="overlay" {...overlayProps}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <div>
            <span className="modal-title">Редактировать заявку</span>
            <div className="u-fs11 u-g2 u-mt2">
              <span className="u-inline-icon"><AppIcon name={getCategoryIcon(category)} size={12} /> {getCategoryLabel(category)}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          {req.type === 'pass' && category !== 'taxi' && (
            <div className="field">
              <label className="field-lbl">{category === 'team' ? 'Имена посетителей' : 'Имя посетителя'}</label>
              <input className="field-inp" value={vName} onChange={(event) => setVName(event.target.value)} onBlur={(event) => setVName(sanitizeText(event.target.value))} autoCapitalize="words" />
            </div>
          )}
          {req.type === 'pass' && category !== 'taxi' && category !== 'team' && (
            <div className="field">
              <label className="field-lbl">Телефон</label>
              <input className="field-inp" value={vPhone} onChange={(event) => setVPhone(event.target.value)} onBlur={(event) => setVPhone(sanitizePhone(event.target.value))} type="tel" inputMode="tel" />
            </div>
          )}
          {req.type === 'pass' && category === 'taxi' && (
            <div className="field">
              <label className="field-lbl">Марка и номер авто</label>
              <input className="field-inp" value={carPlate} onChange={(event) => setCarPlate(event.target.value)} onBlur={(event) => setCarPlate(sanitizeCarPlate(event.target.value))} autoCapitalize="characters" />
            </div>
          )}
          {req.type === 'pass' && needsPlate && category !== 'taxi' && (
            <div className="field">
              <label className="field-lbl">Марка и номер авто</label>
              <input className="field-inp" value={carPlate} onChange={(event) => setCarPlate(event.target.value)} onBlur={(event) => setCarPlate(sanitizeCarPlate(event.target.value))} autoCapitalize="characters" />
            </div>
          )}
          <div className="field">
            <label className="field-lbl">Комментарий</label>
            <textarea className="field-textarea" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} onBlur={(event) => setComment(sanitizeText(event.target.value))} />
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
