/**
 * UserMenu.jsx - A-01: UserMenu extracted from Dashboard.
 * Handles the header user button, dropdown menu, and avatar modal trigger.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';
import { AvatarModal } from '../../ui/Modals';
import { toast } from '../../ui/Toasts';
import { useAvatar, useActions } from '../../store/AppStore';
import { ROLE_LABELS } from '../../constants';
import { canManageRequests } from '../../domain/permissions';

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

export default function UserMenu({ user, pendingCount, onLogout }) {
  const avData = useAvatar(user.uid);
  const { setAvatar, deleteAvatar } = useActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const headerUserRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const close = (e) => {
      if (!headerUserRef.current?.contains(e.target)) setMenuOpen(false);
    };

    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menuOpen]);

  const openAvatarModal = useCallback(() => {
    setMenuOpen(false);
    setAvOpen(true);
  }, []);

  const saveAvatar = useCallback((av) => {
    if (av) setAvatar(user.uid, av);
    else deleteAvatar(user.uid);
    toast(av ? 'Аватарка сохранена' : 'Аватарка удалена', 'success');
  }, [setAvatar, deleteAvatar, user.uid]);

  return (
    <>
      <div
        ref={headerUserRef}
        className="header-user"
        role="button"
        tabIndex={0}
        aria-label="Меню пользователя"
        aria-expanded={menuOpen}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen(o => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMenuOpen(o => !o))}
      >
        <div className="header-info">
          <div className="header-name">{user.name}</div>
          <div className="header-role">{ROLE_LABELS[user.role]}</div>
        </div>
        <div className="u-rel">
          <div className="header-avatar usermenu-avatar-reset">
            <AvatarCircle avData={avData} role={user.role} name={user.name} size={34} fontSize={14} />
          </div>
          {canManageRequests(user.role) && pendingCount > 0 && (
            <span className="usermenu-badge">{formatBadgeCount(pendingCount)}</span>
          )}
        </div>
        {menuOpen && (
          <div className="dropdown">
            <div className="dd-avatar-wrap" onClick={(e) => e.stopPropagation()}>
              <div
                className="usermenu-avatar-clickable"
                role="button"
                tabIndex={0}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openAvatarModal}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openAvatarModal())}
                aria-label="Изменить аватарку"
              >
                <div className="dd-avatar-big usermenu-avatar-reset">
                  <AvatarCircle avData={avData} role={user.role} name={user.name} size={56} fontSize={22} />
                  <div className="dd-avatar-overlay"><AppIcon name="camera" size={14} /></div>
                </div>
              </div>
              <div className="dd-user-info">
                <div className="dd-user-name">{user.name}</div>
                <div className="dd-user-phone">{user.phone}</div>
              </div>
              <button className="dd-upload-btn" onMouseDown={(e) => e.preventDefault()} onClick={openAvatarModal}>
                Настроить аватарку
              </button>
            </div>
            <button className="dd-out" onClick={onLogout}>Выйти из аккаунта</button>
          </div>
        )}
      </div>
      {avOpen && typeof document !== 'undefined' && createPortal(
        <AvatarModal avatar={avData} onSave={saveAvatar} onClose={() => setAvOpen(false)} />,
        document.body,
      )}
    </>
  );
}
