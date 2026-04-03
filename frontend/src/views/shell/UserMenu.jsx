/**
 * UserMenu.jsx — A-01: UserMenu extracted from Dashboard.
 * Handles the header user button, dropdown menu, and avatar modal trigger.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';
import { AvatarModal } from '../../ui/Modals';
import { toast } from '../../ui/Toasts';
import { useAvatar, useActions } from '../../store/AppStore';
import { ROLE_LABELS } from '../../constants';
import { canManageRequests } from '../../domain/permissions.js';

const BADGE_STYLE = {
  position: 'absolute', top: -3, right: -3,
  background: 'var(--err)', color: 'var(--err-t)',
  fontSize: 11, fontWeight: 700, minWidth: 15, height: 15,
  borderRadius: 8, display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: '0 3px', border: '1.5px solid var(--bg)',
};
const AVATAR_STYLE = { background: 'transparent', padding: 0, border: 'none' };
const DD_AVATAR_CLICKABLE_STYLE = { cursor: 'pointer', position: 'relative' };

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

export default function UserMenu({ user, pendingCount, onLogout }) {
  const avData = useAvatar(user.uid);
  const { setAvatar, deleteAvatar } = useActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const headerUserRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!headerUserRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menuOpen]);

  const saveAvatar = useCallback(av => {
    if (av) setAvatar(user.uid, av);
    else    deleteAvatar(user.uid);
    toast(av ? 'Аватарка сохранена' : 'Аватарка удалена', 'success');
  }, [setAvatar, deleteAvatar, user.uid]);

  return (
    <>
      <div
        ref={headerUserRef}
        className="header-user" role="button" tabIndex={0}
        aria-label="Меню пользователя" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMenuOpen(o => !o))}
      >
        <div className="header-info">
          <div className="header-name">{user.name}</div>
          <div className="header-role">{ROLE_LABELS[user.role]}</div>
        </div>
        <div className="u-rel">
          <div className="header-avatar" style={AVATAR_STYLE}>
            <AvatarCircle avData={avData} role={user.role} name={user.name} size={34} fontSize={14} />
          </div>
          {canManageRequests(user.role) && pendingCount > 0 && (
            <span style={BADGE_STYLE}>{formatBadgeCount(pendingCount)}</span>
          )}
        </div>
        {menuOpen && (
          <div className="dropdown">
            <div className="dd-avatar-wrap" onClick={e => e.stopPropagation()}>
              <div
                style={DD_AVATAR_CLICKABLE_STYLE}
                role="button" tabIndex={0}
                onClick={() => { setMenuOpen(false); setAvOpen(true); }}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMenuOpen(false), setAvOpen(true))}
                aria-label="Изменить аватарку"
              >
                <div className="dd-avatar-big" style={AVATAR_STYLE}>
                  <AvatarCircle avData={avData} role={user.role} name={user.name} size={56} fontSize={22} />
                  <div className="dd-avatar-overlay"><AppIcon name="camera" size={14} /></div>
                </div>
              </div>
              <div className="dd-user-info">
                <div className="dd-user-name">{user.name}</div>
                <div className="dd-user-phone">{user.phone}</div>
              </div>
              <button className="dd-upload-btn" onClick={() => { setMenuOpen(false); setAvOpen(true); }}>
                Настроить аватарку
              </button>
            </div>
            <button className="dd-out" onClick={onLogout}>Выйти из аккаунта</button>
          </div>
        )}
      </div>
      {avOpen && <AvatarModal user={user} avatar={avData} onSave={saveAvatar} onClose={() => setAvOpen(false)} />}
    </>
  );
}
