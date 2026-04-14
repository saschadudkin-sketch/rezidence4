import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
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
import type { AppUser, UserRole } from '../store/slices/usersSlice';

type AddUserModalProps = {
  onClose: () => void;
  onDone: () => void;
  initialRole?: UserRole;
};

type AvatarPayload = string | null;

type AvatarModalProps = {
  avatar: AvatarPayload;
  onSave: (avatar: AvatarPayload) => void;
  onClose: () => void;
};

const compressImg = (dataUrl: string) => compressImage(dataUrl, { maxWidth: 256, quality: 0.82 });
const NON_RESIDENT_APARTMENT = '—';

const ADD_USER_TITLE: Record<UserRole, string> = {
  owner: 'Новый собственник',
  tenant: 'Новый арендатор',
  contractor: 'Новый подрядчик',
  concierge: 'Новый консьерж',
  security: 'Новый сотрудник охраны',
  admin: 'Новый администратор',
};

const ADD_USER_HINT: Record<UserRole, string> = {
  owner: 'Добавьте резидента с апартаментом и парковкой, чтобы он сразу получил свой кабинет.',
  tenant: 'Добавьте арендатора с апартаментом и парковкой, чтобы он сразу получил доступ к пропускам.',
  contractor: 'Подрядчик получит рабочие пропуска и техзаявки без resident-разделов.',
  concierge: 'Консьерж увидит лобби-операции, резидентов и журнал доступа.',
  security: 'Сотрудник охраны получит пост, контроль пропусков и журнал доступа.',
  admin: 'Администратор получит операционные разделы и управление пользователями.',
};

export function AddUserModal({ onClose, onDone, initialRole }: AddUserModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+7 ');
  const [role, setRole] = useState<UserRole>(initialRole || 'owner');
  const [apt, setApt] = useState('');
  const [parking, setParking] = useState('');
  const [loading, setLoading] = useState(false);
  const { phoneDb } = useUsers();
  const { addUser } = useActions();
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  const isMountedRef = useIsMounted();
  const isResidentRole = role === 'owner' || role === 'tenant';

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, []);

  const submit = async () => {
    if (!name.trim()) {
      toast('Введите имя', 'error');
      return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      toast('Введите корректный номер телефона', 'error');
      return;
    }
    const norm = normalizePhone(phone);
    if (phoneDb[norm]) {
      toast('Этот номер уже зарегистрирован', 'error');
      return;
    }
    if (isResidentRole && !apt.trim()) {
      toast('Укажите номер апартамента', 'error');
      return;
    }

    setLoading(true);
    try {
      const uid = genId('u');
      const newUser: AppUser = {
        uid,
        name: name.trim(),
        phone,
        role,
        apartment: apt.trim() || NON_RESIDENT_APARTMENT,
        parkingSpot: parking.trim() || null,
      };
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
          <div className="modal-head-main">
            <span className="modal-title">{ADD_USER_TITLE[role]}</span>
            <span className="modal-subtitle">{ADD_USER_HINT[role]}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-lbl">Имя *</label>
            <input className="field-inp" placeholder="Иван Иванов" value={name} onChange={(event) => setName(event.target.value)} autoCapitalize="words" />
          </div>
          <div className="field">
            <label className="field-lbl">Телефон *</label>
            <input className="field-inp" placeholder="+7 000 000-00-00" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" />
          </div>
          <div className="field">
            <label className="field-lbl">Роль</label>
            <select className="field-select" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {(['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'] as UserRole[]).map((itemRole) => (
                <option key={itemRole} value={itemRole}>{ROLE_LABELS[itemRole]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-lbl">Апартамент{(role === 'owner' || role === 'tenant') ? ' *' : ''}</label>
            <input
              className="field-inp"
              placeholder={isResidentRole ? '12' : 'Не нужен для этой роли'}
              value={apt}
              onChange={(event) => setApt(event.target.value)}
              inputMode={isResidentRole ? 'numeric' : 'text'}
            />
          </div>
          <div className="field">
            <label className="field-lbl">Паркинг</label>
            <input
              className="field-inp"
              placeholder={isResidentRole ? 'A-12' : 'Необязательно'}
              value={parking}
              onChange={(event) => setParking(event.target.value)}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={submit} disabled={loading}>
            <span>{loading ? 'Сохранение...' : 'Добавить пользователя'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function AvatarModal({ avatar, onSave, onClose }: AvatarModalProps) {
  const [src, setSrc] = useState<string | null>(avatar);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
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
          stream.getTracks().forEach((track) => track.stop());
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

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast('Файл слишком большой (макс. 10 МБ)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast('Не удалось загрузить фото', 'error');
    reader.onload = async (loadEvent: ProgressEvent<FileReader>) => {
      const result = loadEvent.target?.result;
      if (typeof result !== 'string') return;
      const compressed = await compressImg(result);
      setSrc(typeof compressed === 'string' ? compressed : null);
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
    setSrc(typeof compressed === 'string' ? compressed : null);
    setCameraOpen(false);
    stopCamera();
  };

  const save = () => {
    if (!src) {
      toast('Выберите фото', 'error');
      return;
    }
    onSave(src);
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
