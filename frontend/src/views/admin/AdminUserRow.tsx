import { useState, useRef, useEffect } from 'react';
import { useActions, useAvatar } from '../../store/AppStore';
import { ROLE_LABELS, S_END } from '../../constants';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { toast } from '../../ui/Toasts';
import { toastBySyncResult } from '../../ui/syncFeedback';
import { canDeleteUser, canChangeRole } from '../../domain/permissions';
import { services } from '../../services/providers/serviceContainer';
import { AppIcon } from '../../ui/AppIcon';

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
    if (!name.trim()) { toast('Введите имя', 'error'); return; }
    const patch = { name: name.trim(), phone: phone.trim(), role, apartment: apt.trim() || '—', parkingSpot: parking.trim() || null };
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
    <div
      style={{ background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--b1)', marginBottom: 6, overflow: 'hidden', transition: 'border-color .13s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--b2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--b1)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <div className="u-fs0">
          <AvatarCircle avData={avData} role={u.role} name={u.name} size={36} fontSize={14} />
        </div>
        <div className="u-flex1 u-mw0">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>{u.name}</span>
            <span className={'admin-badge ' + u.role}>{ROLE_LABELS[u.role]}</span>
            {isSelf && <span style={{ fontSize: 11, color: 'var(--g2)', letterSpacing: .5 }}>• это вы</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t4)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        <div className="edit-inline" style={{ margin: '0 10px 10px', borderRadius: 6 }}>
          <div className="edit-inline-row">
            <input className="edit-inline-inp" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} autoCapitalize="words" autoFocus />
            <input className="edit-inline-inp" placeholder="Телефон" value={phone} onChange={e => setPhone(e.target.value)} type="tel" inputMode="tel" />
          </div>
          <div className="edit-inline-row">
            <select className="edit-inline-sel" value={role} onChange={e => setRole(e.target.value)}
              disabled={!canRole} title={!canRole ? 'Нельзя изменить собственную роль' : ''}>
              {['owner','tenant','contractor','concierge','security','admin'].map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <input className="edit-inline-inp" placeholder="Апарт." value={apt} onChange={e => setApt(e.target.value)} style={{ maxWidth: 80 }} />
          <input className="edit-inline-inp" placeholder="Парк." value={parking} onChange={e => setParking(e.target.value)} style={{ width: 80 }} />
          </div>
          <div style={S_END}>
            <button className="btn-outline" onClick={handleCancel}>Отмена</button>
            <button className="btn-gold u-pad-btn" onClick={save}><span>Сохранить</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
