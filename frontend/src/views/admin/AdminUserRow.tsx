import { useState, useRef, useEffect } from 'react';
import { useActions, useAvatar } from '../../store/AppStore';
import { ROLE_LABELS } from '../../constants';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { toast } from '../../ui/Toasts';
import { toastBySyncResult } from '../../ui/syncFeedback';
import { canDeleteUser, canChangeRole } from '../../domain/permissions';
import { services } from '../../services/providers/serviceContainer';
import { AppIcon } from '../../ui/AppIcon';
import { sanitizeUserFormFields, validateUserFormFields } from '../../utils/formPolicy';

export default function AdminUserRow({ u, currentUser }) {
  const isSelf = u.uid === currentUser.uid;
  const canDel  = canDeleteUser(currentUser, u);
  const canRole = canChangeRole(currentUser, u);

  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(u.name);
  const [phone,   setPhone]   = useState(u.phone);
  const [role,    setRole]    = useState(u.role);
  const [apt,     setApt]     = useState(u.apartment === '—' ? '' : u.apartment);
  const [parking, setParking] = useState(u.parkingSpot || '');
  const { updateUser, deleteUser } = useActions();
  const avData = useAvatar(u.uid);

  // isMountedRef: guards setState when row unmounts mid-flight (rapid delete while save is pending).
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  async function save() {
    const sanitized = sanitizeUserFormFields({
      name,
      phone,
      apartment: apt,
      parkingSpot: parking,
    });
    if (!sanitized.name) { toast('Введите имя', 'error'); return; }
    const validationErr = validateUserFormFields({ name: sanitized.name, phone: sanitized.phone });
    if (validationErr) { toast(validationErr, 'error'); return; }
    const patch = {
      name: sanitized.name,
      phone: sanitized.phone,
      role,
      apartment: sanitized.apartment || '—',
      parkingSpot: sanitized.parkingSpot || null,
    };
    // mode declared outside try so it's accessible in the post-await code
    let mode;
    try {
      mode = await services.admin.saveUserEverywhere({ uid: u.uid, patch, updateLocal: updateUser, oldPhone: u.phone });
    } catch {
      if (isMountedRef.current) toast('Ошибка сохранения', 'error');
      return;
    }
    if (!isMountedRef.current) return;
    setEditing(false);
    toastBySyncResult(mode, 'Данные сохранены', 'Пользователь сохранён локально. Синхронизация будет повторена позже');
  }

  async function del() {
    if (!canDel) { toast('Нельзя удалить собственный аккаунт', 'error'); return; }
    // mode declared outside try so it's accessible in the post-await code
    let mode;
    try {
      mode = await services.admin.removeUserEverywhere({ uid: u.uid, removeLocal: deleteUser });
    } catch {
      if (isMountedRef.current) toast('Ошибка удаления', 'error');
      return;
    }
    if (!isMountedRef.current) return;
    toastBySyncResult(mode, u.name + ' удалён', 'Удаление выполнено локально. Синхронизация будет повторена позже');
  }

  function handleCancel() { setEditing(false); }

  return (
    <div className="admin-user-row-card">
      <div className="u-flex u-flex-center u-gap10 u-pad10-12">
        <div className="u-fs0">
          <AvatarCircle avData={avData} role={u.role} name={u.name} size={36} fontSize={14} />
        </div>
        <div className="u-flex1 u-mw0">
          <div className="u-flex u-flex-center u-gap8 u-wrap">
            <span className="u-fs13 u-fw500 u-t1">{u.name}</span>
            <span className={'admin-badge ' + u.role}>{ROLE_LABELS[u.role]}</span>
            {isSelf && <span className="admin-user-self-mark">• это вы</span>}
          </div>
          <div className="u-fs11 u-t4 u-mt2 u-flex u-gap8 u-wrap">
            <span>{u.phone}</span>
            {u.apartment !== '—' && <span>Апарт. {u.apartment}</span>}
            {u.parkingSpot && <span><AppIcon name="car" className="u-inline-icon" /> {u.parkingSpot}</span>}
          </div>
        </div>
        <div className="u-row-g5-fs0">
          <button className="btn-edit" onClick={() => setEditing(e => !e)} aria-label={editing ? 'Закрыть' : 'Редактировать'}>
            <AppIcon name={editing ? 'close' : 'edit'} />
          </button>
          {canDel && <button className="btn-del-sm" onClick={del} aria-label="Удалить пользователя"><AppIcon name="trash" /></button>}
        </div>
      </div>

      {editing && (
        <div className="edit-inline admin-user-edit-wrap">
          <div className="edit-inline-row">
            <input className="edit-inline-inp" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} onBlur={e => setName(sanitizeUserFormFields({ name: e.target.value, phone, apartment: apt, parkingSpot: parking }).name)} autoCapitalize="words" autoFocus />
            <input className="edit-inline-inp" placeholder="Телефон" value={phone} onChange={e => setPhone(e.target.value)} onBlur={e => setPhone(sanitizeUserFormFields({ name, phone: e.target.value, apartment: apt, parkingSpot: parking }).phone)} type="tel" inputMode="tel" />
          </div>
          <div className="edit-inline-row">
            <select className="edit-inline-sel" value={role} onChange={e => setRole(e.target.value)}
              disabled={!canRole} title={!canRole ? 'Нельзя изменить собственную роль' : ''}>
              {['owner','tenant','contractor','concierge','security','admin'].map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <input className="edit-inline-inp admin-user-apt-inp" placeholder="Апарт." value={apt} onChange={e => setApt(e.target.value)} onBlur={e => setApt(sanitizeUserFormFields({ name, phone, apartment: e.target.value, parkingSpot: parking }).apartment)} />
          <input className="edit-inline-inp admin-user-park-inp" placeholder="Парк." value={parking} onChange={e => setParking(e.target.value)} onBlur={e => setParking(sanitizeUserFormFields({ name, phone, apartment: apt, parkingSpot: e.target.value }).parkingSpot)} />
          </div>
          <div className="admin-user-actions-end">
            <button className="btn-outline" onClick={handleCancel}>Отмена</button>
            <button className="btn-gold u-pad-btn" onClick={save}><span>Сохранить</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
