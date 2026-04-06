import React, { memo } from 'react';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';
import { ROLE_LABELS } from '../../constants';
import { can } from '../../domain/permissions';
import { fmtTime } from '../../utils';
import { REACTIONS } from '../constants';

const CheckIcon = memo(function CheckIcon({ status }: { status: 'sent' | 'read' | null }) {
  if (!status) return null;
  const cls = status === 'read' ? 'msg-check-read' : 'msg-check-sent';
  if (status === 'sent') {
    return (
      <span className={'msg-checks ' + cls} aria-label="Отправлено">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className={'msg-checks ' + cls} aria-label="Прочитано">
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 5L8.5 8.5L15 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
});

interface ChatMessageItemProps {
  m: ChatMessage;
  showSep: boolean;
  dayLabel: string;
  user: ChatUser;
  users: Record<string, ChatUser>;
  isGrouped: boolean;
  quotedMsg: ChatMessage | null;
  readStatus: 'sent' | 'read' | null;
  msgMenu: string | null;
  editingMsg: { id: string; text: string } | null;
  menuPopupRef: React.RefObject<HTMLDivElement | null>;
  setMsgRef: (id: string, el: HTMLDivElement | null) => void;
  linkify: (text: string) => React.ReactNode;
  onSetLightbox: (src: string | null) => void;
  onScrollToMsg: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onStartReply: (m: ChatMessage) => void;
  onSetEditingMsg: (m: { id: string; text: string }) => void;
  onRequestDelete: (id: string) => void;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onSaveEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onTouchStart: (e: React.TouchEvent, m: ChatMessage) => void;
  onTouchMove: (e: React.TouchEvent, m: ChatMessage) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onLongPressStart: (e: React.TouchEvent, msgId: string) => void;
  onLongPressEnd: () => void;
  onCloseMenu: () => void;
}

interface ChatUser {
  uid?: string;
  name?: string;
  role?: string;
  avatar?: string | null;
}

interface ChatMessage {
  id: string;
  uid?: string;
  name?: string;
  role?: string;
  text?: string;
  photo?: string | null;
  at?: string | Date;
  edited?: boolean;
  replyTo?: { id?: string; name?: string; text?: string; photo?: string | null };
  reactions?: Record<string, unknown[]>;
}

export function ChatMessageItem({
  m,
  showSep,
  dayLabel,
  user,
  users,
  isGrouped,
  quotedMsg,
  readStatus,
  msgMenu,
  editingMsg,
  menuPopupRef,
  setMsgRef,
  linkify,
  onSetLightbox,
  onScrollToMsg,
  onToggleMenu,
  onStartReply,
  onSetEditingMsg,
  onRequestDelete,
  onToggleReaction,
  onSaveEdit,
  onCancelEdit,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onLongPressStart,
  onLongPressEnd,
  onCloseMenu,
}: ChatMessageItemProps) {
  return (
    <React.Fragment>
      {showSep && <div className="msg-date-sep"><span>{dayLabel}</span></div>}
      <div
        className={'msg-row ' + (m.uid === user.uid ? 'mine' : '') + (isGrouped ? ' grouped' : '') + ' msg-row-rel'}
        onTouchStart={e => { onTouchStart(e, m); onLongPressStart(e, m.id); }}
        onTouchMove={e => { onTouchMove(e, m); onLongPressEnd(); }}
        onTouchEnd={e => { onTouchEnd(e); onLongPressEnd(); }}
        onDoubleClick={() => onStartReply(m)}
      >
        {msgMenu === m.id && (
          <>
            <div className="msg-menu-backdrop" onClick={onCloseMenu} />
            <div
              className="msg-menu-popup"
              ref={menuPopupRef}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              onTouchEnd={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
            >
              <button className="msg-menu-item" onMouseDown={e => e.stopPropagation()} onClick={() => { onStartReply(m); onCloseMenu(); }}>↩ Ответить</button>
              {can(user).editMessage(m) && !m.photo && <button className="msg-menu-item" onMouseDown={e => e.stopPropagation()} onClick={() => { onSetEditingMsg({ id: m.id, text: m.text }); onCloseMenu(); }}><AppIcon name="edit" className="u-inline-icon" /> Редактировать</button>}
              {can(user).deleteMessage(m) && <button className="msg-menu-item danger" onMouseDown={e => e.stopPropagation()} onClick={() => { onRequestDelete(m.id); onCloseMenu(); }}><AppIcon name="trash" className="u-inline-icon" /> Удалить</button>}
              <div className="msg-menu-reactions">
                {REACTIONS.map(emoji => (
                  <button key={emoji} className="reaction-picker-btn" onMouseDown={e => e.stopPropagation()} onClick={() => { onToggleReaction(m.id, emoji); onCloseMenu(); }}>{emoji}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {m.uid !== user.uid && !isGrouped && (
          <div className="msg-av msg-av-reset">
            <AvatarCircle avData={(users[m.uid] && users[m.uid].avatar) || null} role={m.role} name={m.name || '?'} size={28} fontSize={11} />
          </div>
        )}
        {m.uid !== user.uid && isGrouped && <div className="msg-av-spacer" />}
        <div>
          <div
            className={'msg-bubble ' + (m.uid === user.uid ? 'mine' : 'theirs')}
            ref={el => setMsgRef(m.id, el)}
          >
            {m.uid !== user.uid && !isGrouped && (
              <div className="msg-sender">
                {(m.role === 'security' || m.role === 'concierge') ? ROLE_LABELS[m.role] : m.name}
              </div>
            )}
            {quotedMsg && (
              <div
                className="msg-reply-quote"
                role="button"
                tabIndex={0}
                aria-label="Перейти к цитируемому сообщению"
                onClick={() => onScrollToMsg(quotedMsg.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onScrollToMsg(quotedMsg.id);
                  }
                }}
              >
                <div className="msg-reply-quote-name">{quotedMsg.name || m.replyTo?.name}</div>
                <div className="msg-reply-quote-text">{quotedMsg.photo ? 'Фото' : quotedMsg.text || m.replyTo?.text}</div>
              </div>
            )}
            {m.photo && <img src={m.photo} className="msg-photo" alt="фото" onClick={() => onSetLightbox(m.photo)} />}
            {m.text && <div className="msg-text">{linkify(m.text)}</div>}
            <div className="msg-time">
              <span>{fmtTime(m.at)}</span>
              {m.edited && <span className="msg-edited-mark">изменено</span>}
              <CheckIcon status={readStatus} />
            </div>
            <button className="msg-ctx-btn" onClick={e => { e.stopPropagation(); onToggleMenu(m.id); }} aria-label="Меню">⋯</button>
          </div>
          {editingMsg && editingMsg.id === m.id && (
            <div className="msg-edit-wrap">
              <textarea
                className="msg-edit-inp"
                rows={2}
                value={editingMsg.text}
                onChange={e => onSetEditingMsg({ id: editingMsg.id, text: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(m.id, editingMsg.text); }
                  if (e.key === 'Escape') { onCancelEdit(); }
                }}
                autoFocus
              />
              <div className="msg-edit-hint"><span><kbd>Enter</kbd> сохранить</span><span><kbd>Esc</kbd> отменить</span></div>
            </div>
          )}
          {m.reactions && Object.keys(m.reactions).length > 0 && (
            <div className="msg-reactions">
              {Object.entries(m.reactions).map(([emoji, uids]) => {
                const safeUids = Array.isArray(uids) ? uids : [];
                if (!safeUids.length) return null;
                return (
                  <button key={emoji} className={'reaction-badge' + (safeUids.includes(user.uid) ? ' mine' : '')} onClick={() => onToggleReaction(m.id, emoji)} title={safeUids.length + ' чел.'}>
                    <span>{emoji}</span><span className="reaction-count">{safeUids.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}
