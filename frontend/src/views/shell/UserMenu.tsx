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
import type { AppUser } from '../../store/slices/usersSlice';

type UserMenuProps = {
  user: AppUser;
  pendingCount: number;
  onLogout: () => void;
  cycleTheme: () => void;
  themeIcon: string;
  themeLabel: string;
};

const formatBadgeCount = (count: number) => (count > 9 ? '9+' : String(count));

export default function UserMenu({ user, pendingCount, onLogout, cycleTheme, themeIcon, themeLabel }: UserMenuProps) {
  const avData = useAvatar(user.uid);
  const { setAvatar, deleteAvatar } = useActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const headerUserRef = useRef<HTMLDivElement | null>(null);
  const menuId = `user-menu-${user.uid}`;

  useEffect(() => {
    if (!menuOpen) return undefined;

    const close = (event: PointerEvent) => {
      const targetNode = event.target instanceof Node ? event.target : null;
      if (targetNode && !headerUserRef.current?.contains(targetNode)) setMenuOpen(false);
    };

    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menuOpen]);

  const openAvatarModal = useCallback(() => {
    setMenuOpen(false);
    setAvOpen(true);
  }, []);

  const saveAvatar = useCallback((avatar: string | null) => {
    if (avatar) setAvatar(user.uid, avatar);
    else deleteAvatar(user.uid);
    toast(avatar ? 'Аватарка сохранена' : 'Аватарка удалена', 'success');
  }, [setAvatar, deleteAvatar, user.uid]);

  return (
    <>
      <div
        ref={headerUserRef}
        className="header-user-menu"
      >
        <button
          type="button"
          className="header-user"
          aria-label="Меню пользователя"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMenuOpen((value) => !value)}
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
        </button>
        {menuOpen && (
          <div
            id={menuId}
            className="dropdown"
          >
            <div className="dd-avatar-wrap">
              <button
                type="button"
                className="usermenu-avatar-clickable"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openAvatarModal}
                aria-label="Изменить аватарку"
              >
                <div className="dd-avatar-big usermenu-avatar-reset">
                  <AvatarCircle avData={avData} role={user.role} name={user.name} size={56} fontSize={22} />
                  <div className="dd-avatar-overlay"><AppIcon name="camera" size={14} /></div>
                </div>
              </button>
              <div className="dd-user-info">
                <div className="dd-user-name">{user.name}</div>
                <div className="dd-user-phone">{user.phone}</div>
              </div>
              <button className="dd-upload-btn" onMouseDown={(event) => event.preventDefault()} onClick={openAvatarModal}>
                Настроить аватарку
              </button>
            </div>
            <button
              className="dd-action"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                cycleTheme();
                setMenuOpen(false);
              }}
              aria-label={`Сменить тему. Сейчас: ${themeLabel}`}
            >
              <span className="dd-action-icon"><AppIcon name={themeIcon} size={14} /></span>
              <span>Тема: {themeLabel}</span>
            </button>
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
