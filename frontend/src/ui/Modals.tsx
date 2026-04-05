import { useState, useEffect, useRef } from 'react';
import { useActions, useUsers } from '../store/AppStore';
import { ROLE_LABELS } from '../constants/index';
import { normalizePhone, genId } from '../utils';
import { toast } from './Toasts';
import { lockScroll, unlockScroll } from './scrollLock';
import { AppIcon } from './AppIcon';
import { useIsMounted } from '../hooks/useIsMounted';
import { MAX_FILE_SIZE_BYTES } from '../constants/limits';
import { compressImage } from '../utils/compressImage';

// ─── ADD USER MODAL ───────────────────────────────────────────────────────────

export function AddUserModal({ onClose, onDone, initialRole }) {
  const [name,    setName]    = useState('');
  const [phone,   setPhone]   = useState('+7 ');
  const [role,    setRole]    = useState(initialRole || 'owner');
  const [apt,     setApt]     = useState('');
  const [loading, setLoading] = useState(false);
  const { phoneDb } = useUsers();
  const { addUser }  = useActions();

  // FE-02: useIsMounted заменяет inline isMountedRef-паттерн
  const isMountedRef = useIsMounted();

  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  const submit = async () => {
    if (!name.trim()) { toast('Введите имя', 'error'); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) { toast('Введите корректный номер телефона', 'error'); return; }
    const norm = normalizePhone(phone);
    if (phoneDb[norm]) { toast('Этот номер уже зарегистрирован', 'error'); return; }
    // FA-09: apartment required for roles that live in apartments
    if ((role === 'owner' || role === 'tenant') && !apt.trim()) {
      toast('Укажите номер апартамента', 'error'); return;
    }
    setLoading(true);
    // FIX [BUG-10]: убрана искусственная задержка 400мс — пользователь ждал без причины,
    // и setState вызывался на потенциально unmounted компоненте если модал закрыли быстро.
    try {
      const uid  = genId('u');
      const newU = { uid, name: name.trim(), phone, role, apartment: apt.trim() || '—' };
      addUser(newU);
      if (!isMountedRef.current) return;
      toast(name.trim() + ' добавлен в систему', 'success');
      onDone(); onClose();
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-head">
          <span className="modal-title">Новый жилец</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field"><label className="field-lbl">Имя *</label>
            <input className="field-inp" placeholder="Иван Иванов" value={name} onChange={e => setName(e.target.value)} autoCapitalize="words" />
          </div>
          <div className="field"><label className="field-lbl">Телефон *</label>
            <input className="field-inp" placeholder="+7 000 000-00-00" type="tel" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div className="field"><label className="field-lbl">Роль</label>
            <select className="field-select" value={role} onChange={e => setRole(e.target.value)}>
              {['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'].map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-lbl">
              Апартамент{(role === 'owner' || role === 'tenant') ? ' *' : ''}
            </label>
            <input className="field-inp" placeholder="12" value={apt} onChange={e => setApt(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={submit} disabled={loading}>
            <span>{loading ? 'Сохранение...' : 'Добавить'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AVATAR MODAL ─────────────────────────────────────────────────────────────

// CQ-02: compressImg → общая утилита compressImage из utils/compressImage.js
// Аватар: maxWidth=256 (квадратный), quality=0.82
const compressImg = (dataUrl) => compressImage(dataUrl, { maxWidth: 256, quality: 0.82 });

export function AvatarModal({ user, avatar, onSave, onClose }) {
  const [src, setSrc] = useState(avatar && avatar.type === 'photo' ? avatar.src : null);

  useEffect(() => {
    lockScroll();
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => { unlockScroll(); window.removeEventListener('keydown', fn); };
  }, [onClose]);

  const onFile = e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE_BYTES) { toast('Файл слишком большой (макс. 10 МБ)', 'error'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('Не удалось загрузить фото', 'error');
    reader.onload  = async ev => {
      const compressed = await compressImg(ev.target.result);
      setSrc(compressed);
    };
    reader.readAsDataURL(f);
  };

  const save = () => {
    if (!src) { toast('Выберите фото', 'error'); return; }
    onSave({ type: 'photo', src });
    onClose();
  };

  return (
    <div className="av-modal" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="av-panel">
        <div className="av-panel-head">
          <span className="av-panel-title">Фото профиля</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="av-preview">
          <div className="av-preview-circle">
            {src
              ? <img src={src} alt="" className="u-cover" />
              : <div className="av-preview-empty"><AppIcon name="camera" size={28} /></div>
            }
          </div>
        </div>
        <div className="av-actions">
          <label className="av-action-btn">
            <span className="av-action-ico"><AppIcon name="file" size={14} /></span>
            <span>Из галереи</span>
            <input type="file" accept="image/*" className="u-none" onChange={onFile} />
          </label>
          <label className="av-action-btn">
            <span className="av-action-ico"><AppIcon name="camera" size={14} /></span>
            <span>Камера</span>
            <input type="file" accept="image/*" capture="environment" className="u-none" onChange={onFile} />
          </label>
        </div>
        {avatar && <button className="av-remove" onClick={() => { onSave(null); onClose(); }}>Удалить фото</button>}
        <div className="av-foot-actions">
          <button className="btn-outline u-flex1" onClick={onClose}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={save}><span>Сохранить</span></button>
        </div>
      </div>
    </div>
  );
}
