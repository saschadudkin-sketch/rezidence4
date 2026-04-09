import { useState, useEffect, useRef, useCallback } from 'react';
import { useActions, useUsers } from '../store/AppStore';
import { ROLE_LABELS } from '../constants/index';
import { normalizePhone, genId } from '../utils';
import { toast } from './Toasts';
import { lockScroll, unlockScroll } from './scrollLock';
import { AppIcon } from './AppIcon';
import { useIsMounted } from '../hooks/useIsMounted';
import { MAX_FILE_SIZE_BYTES } from '../constants/limits';
import { compressImage } from '../utils/compressImage';
import { useModalAccessibility } from './useModalAccessibility';

export function AddUserModal({ onClose, onDone, initialRole }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+7 ');
  const [role, setRole] = useState(initialRole || 'owner');
  const [apt, setApt] = useState('');
  const [loading, setLoading] = useState(false);
  const { phoneDb } = useUsers();
  const { addUser } = useActions();
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
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
    if ((role === 'owner' || role === 'tenant') && !apt.trim()) {
      toast('Укажите номер апартамента', 'error');
      return;
    }

    setLoading(true);
    try {
      const uid = genId('u');
      const newUser = { uid, name: name.trim(), phone, role, apartment: apt.trim() || '—' };
      addUser(newUser);
      if (!isMountedRef.current) return;
      toast(`${name.trim()} добавлен в систему`, 'success');
      onDone();
      onClose();
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  return (
    <div className="overlay" {...overlayProps}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <span className="modal-title">Новый жилец</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-lbl">Имя *</label>
            <input className="field-inp" placeholder="Иван Иванов" value={name} onChange={e => setName(e.target.value)} autoCapitalize="words" />
          </div>
          <div className="field">
            <label className="field-lbl">Телефон *</label>
            <input className="field-inp" placeholder="+7 000 000-00-00" type="tel" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div className="field">
            <label className="field-lbl">Роль</label>
            <select className="field-select" value={role} onChange={e => setRole(e.target.value)}>
              {['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'].map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-lbl">Апартамент{(role === 'owner' || role === 'tenant') ? ' *' : ''}</label>
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

const compressImg = (dataUrl) => compressImage(dataUrl, { maxWidth: 256, quality: 0.82 });

export function AvatarModal({ avatar, onSave, onClose }) {
  const [src, setSrc] = useState(avatar && avatar.type === 'photo' ? avatar.src : null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (!cameraOpen) return undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Камера недоступна в этом браузере');
      return undefined;
    }

    let cancelled = false;
    setCameraError('');

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setCameraError('Не удалось открыть камеру');
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraOpen, stopCamera]);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast('Файл слишком большой (макс. 10 МБ)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast('Не удалось загрузить фото', 'error');
    reader.onload = async (ev) => {
      const compressed = await compressImg(ev.target.result);
      setSrc(compressed);
      setCameraOpen(false);
      stopCamera();
    };
    reader.readAsDataURL(file);
  };

  const openCamera = () => {
    setCameraError('');
    setCameraOpen(true);
  };

  const captureFromCamera = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 720;
    const size = Math.min(width, height);
    const sx = Math.max(0, (width - size) / 2);
    const sy = Math.max(0, (height - size) / 2);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast('Не удалось обработать кадр', 'error');
      return;
    }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    const compressed = await compressImg(canvas.toDataURL('image/jpeg', 0.92));
    setSrc(compressed);
    setCameraOpen(false);
    stopCamera();
  };

  const save = () => {
    if (!src) { toast('Выберите фото', 'error'); return; }
    onSave({ type: 'photo', src });
    onClose();
  };

  return (
    <div className="av-modal" {...overlayProps}>
      <div className="av-panel" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="av-panel-head">
          <span className="av-panel-title">Фото профиля</span>
          <button className="modal-close" onClick={() => { setCameraOpen(false); stopCamera(); onClose(); }} aria-label="Закрыть">
            <AppIcon name="close" size={14} />
          </button>
        </div>
        <div className="av-preview">
          <div className="av-preview-circle">
            {src
              ? <img src={src} alt="" className="u-cover" />
              : <div className="av-preview-empty"><AppIcon name="camera" size={28} /></div>}
          </div>
          {cameraOpen && (
            <div className="av-camera-stage">
              {cameraError
                ? <div className="av-camera-fallback">{cameraError}</div>
                : <video ref={videoRef} className="av-camera-video" playsInline muted autoPlay />}
            </div>
          )}
        </div>
        <div className="av-actions">
          <label className="av-action-btn">
            <span className="av-action-ico"><AppIcon name="image" size={14} /></span>
            <span>Из галереи</span>
            <input type="file" accept="image/*" className="u-none" onChange={onFile} />
          </label>
          <button type="button" className="av-action-btn" onClick={openCamera}>
            <span className="av-action-ico"><AppIcon name="camera" size={14} /></span>
            <span>Камера</span>
          </button>
        </div>
        {cameraOpen && (
          <div className="av-camera-actions">
            <button className="btn-outline u-flex1" onClick={() => { setCameraOpen(false); stopCamera(); }}>Отмена камеры</button>
            <button className="btn-gold u-flex2" onClick={captureFromCamera} disabled={!cameraReady}>
              <span>{cameraReady ? 'Снять' : 'Подключение...'}</span>
            </button>
          </div>
        )}
        {avatar && <button className="av-remove" onClick={() => { onSave(null); onClose(); }}>Удалить фото</button>}
        <div className="av-foot-actions">
          <button className="btn-outline u-flex1" onClick={() => { setCameraOpen(false); stopCamera(); onClose(); }}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={save}><span>Сохранить</span></button>
        </div>
        <canvas ref={canvasRef} className="u-none" />
      </div>
    </div>
  );
}
