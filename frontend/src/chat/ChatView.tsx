import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useActions, useChat, useUsers } from '../store/AppStore';
import { ROLE_LABELS } from '../constants/index';
import { fmtTime, genId } from '../utils';
import { AvatarCircle } from '../ui/AvatarCircle';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import { toast } from '../ui/Toasts';
import { can } from '../domain/permissions';
import { services } from '../services/providers/serviceContainer';
import { isLiveMode } from '../config/runtimeMode';
import { AppIcon } from '../ui/AppIcon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useChatSearch } from './hooks/useChatSearch';
import { useChatComposer } from './hooks/useChatComposer';
import { useChatData } from './hooks/useChatData';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage } from '../store/slices/chatSlice';
import type { AppUser, UserRole } from '../store/slices/usersSlice';
import type { ChatRefMessage } from './hooks/useChatComposer';

type ReadStatus = 'sent' | 'read';

type ChatViewMessage = ChatMessage & {
  role?: UserRole;
  photo?: string | null;
  replyTo?: ChatRefMessage;
  edited?: boolean;
  reactions?: Record<string, string[]>;
};

type SwipeState = {
  startX?: number;
  startY?: number;
  msgId?: string;
  el?: HTMLDivElement;
  triggered?: boolean;
};

interface CheckIconProps {
  status: ReadStatus | null;
}

function fmtDateSep(date: string | Date): string {
  const value = new Date(date);
  const now = new Date();
  const nowMidnight = now.getTime() - (now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1_000 + now.getMilliseconds());
  const valueMidnight = value.getTime() - (value.getHours() * 3_600_000 + value.getMinutes() * 60_000 + value.getSeconds() * 1_000 + value.getMilliseconds());
  if (valueMidnight === nowMidnight) return 'Сегодня';
  if (valueMidnight === nowMidnight - 86_400_000) return 'Вчера';
  const sameYear = value.getFullYear() === now.getFullYear();
  return value.toLocaleDateString('ru-RU', sameYear
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDayKey(date: string | Date): string {
  return new Date(date).toDateString();
}

function linkify(text: string): React.ReactNode {
  const urlRx = /\bhttps?:\/\/[^\s<>"'()[\]{}|\\^`]+/gi;
  const parts = text.split(urlRx);
  const matches = text.match(urlRx) || [];
  if (!matches.length) return text;
  return parts.flatMap((part: string, index: number) => {
    const url = matches[index - 1];
    if (index === 0 || !url) return [part];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [url, part];
      return [
        <a key={`${url.slice(0, 20)}_${index}`} href={parsed.href} target="_blank" rel="noopener noreferrer" className="msg-link">{url}</a>,
        part,
      ];
    } catch {
      return [url, part];
    }
  });
}

const CheckIcon = memo(function CheckIcon({ status }: CheckIconProps) {
  if (!status) return null;
  const cls = status === 'read' ? 'msg-check-read' : 'msg-check-sent';
  if (status === 'sent') {
    return (
      <span className={'msg-checks ' + cls} aria-label="Отправлено">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  return (
    <span className={'msg-checks ' + cls} aria-label="Прочитано">
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 5L8.5 8.5L15 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
});

const REACTIONS = ['👍', '❤️', '😂', '😮', '👎'];
const EMOJI_GRID = [
  '😀','😂','🤣','😊','😍','🥰','😘','😋','🤔','😏',
  '😢','😭','😤','🤬','😱','🥺','👋','👍','👎','👏',
  '🙏','💪','❤️','🔥','⭐','✅','❌','⚡','🎉','🏠',
  '🚗','📦','🔧','👷','🚕','📞','📸','🔑','🚪','⏰',
];

function getReplyName(message: ChatViewMessage, viewer: AppUser): string {
  if (message.uid === viewer.uid) return 'Вы';
  if (message.role === 'security' || message.role === 'concierge') return ROLE_LABELS[message.role];
  return message.name;
}

function toChatSendPayload(message: ChatViewMessage): Partial<ChatMessage> {
  return {
    id: message.id,
    text: message.text,
    photo: message.photo ?? null,
    replyTo: message.replyTo ?? null,
  };
}

function isPersistedChatMessage(value: unknown): value is ChatViewMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatViewMessage>;
  return typeof candidate.id === 'string'
    && typeof candidate.uid === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.text === 'string';
}

function isReactionMap(value: unknown): value is Record<string, string[]> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((uids) =>
      Array.isArray(uids) && uids.every((uid) => typeof uid === 'string'),
    );
}

function getPersistedReactions(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== 'object') return null;
  const reactions = (value as { reactions?: unknown }).reactions;
  return isReactionMap(reactions) ? reactions : null;
}

export function ChatView({ user }: { user: AppUser }) {
  const { chat, chatLastSeen } = useChat();
  const { sendMessage, updateMessage, deleteMessage, setAllMessages } = useActions();
  const { users } = useUsers();
  const { text, setText, replyTo, setReplyTo, editingMsg, setEditingMsg, showEmoji, setShowEmoji } = useChatComposer();
  const [photoSending, setPhotoSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [msgMenu, setMsgMenu] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);

  const msgsContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const swipeRef = useRef<SwipeState>({});
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuPopupRef = useRef<HTMLDivElement | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const chatMetaRef = useRef({
    firstId: chat[0]?.id ?? null,
    lastId: chat[chat.length - 1]?.id ?? null,
    length: chat.length,
  });

  const {
    hasMore,
    loadingOlder,
    historyError,
    initialHistoryError,
    loadOlderMessages,
    retryInitialSync,
  } = useChatData({ chat, setAllMessages, msgsContainerRef });

  const {
    searchQuery,
    setSearchQuery,
    showSearch,
    setShowSearch,
    serverSearchLoading,
    serverSearchError,
    setSearchRetryTick,
    filteredChat,
  } = useChatSearch(chat as ChatViewMessage[], hasMore, services.chat.getMessages);

  const scrollToMsg = useCallback((id: string) => {
    const el = msgRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 1200);
  }, []);

  const msgTimestamps = useMemo(
    () => new Map(filteredChat.map((message) => [message.id, new Date(message.at).getTime()])),
    [filteredChat],
  );

  const otherUids = useMemo(
    () => Object.keys(users).filter((uid) => uid !== user.uid),
    [users, user.uid],
  );

  const getReadStatus = useCallback((message: ChatViewMessage): ReadStatus | null => {
    if (message.uid !== user.uid) return null;
    const msgTime = new Date(message.at).getTime();
    if (otherUids.length === 0) return 'sent';
    return otherUids.every((uid) => (chatLastSeen[uid] || 0) >= msgTime) ? 'read' : 'sent';
  }, [user.uid, otherUids, chatLastSeen]);

  const focusComposer = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const syncComposerHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 88)}px`;
  }, []);

  useEffect(() => {
    syncComposerHeight();
  }, [text, syncComposerHeight]);

  useEffect(() => {
    const container = msgsContainerRef.current;
    const nextMeta = {
      firstId: chat[0]?.id ?? null,
      lastId: chat[chat.length - 1]?.id ?? null,
      length: chat.length,
    };

    if (!container || chat.length === 0) {
      chatMetaRef.current = nextMeta;
      return;
    }

    const prevMeta = chatMetaRef.current;
    const initialLoad = prevMeta.length === 0 && nextMeta.length > 0;
    const appendedMessage =
      nextMeta.length > prevMeta.length &&
      nextMeta.firstId === prevMeta.firstId &&
      nextMeta.lastId !== prevMeta.lastId;
    const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    const shouldStickToBottom = initialLoad || distanceFromBottom < 160;

    if ((initialLoad || appendedMessage) && shouldStickToBottom) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }

    chatMetaRef.current = nextMeta;
  }, [chat]);

  useEffect(() => {
    if (!msgMenu) return;
    function handleOutsideClick(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (menuPopupRef.current && target instanceof Node && !menuPopupRef.current.contains(target)) {
        setMsgMenu(null);
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [msgMenu]);

  useEffect(() => {
    return () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, []);

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    const message = (chat as ChatViewMessage[]).find((entry) => entry.id === msgId);
    if (!message) return;
    const prev = message.reactions || {};
    const uids = Array.isArray(prev[emoji]) ? prev[emoji] : [];
    const already = uids.includes(user.uid);
    const newUids = already ? uids.filter((uid) => uid !== user.uid) : [...uids, user.uid];
    const nextReactions: Record<string, string[]> = { ...prev, [emoji]: newUids };
    Object.keys(nextReactions).forEach((key) => {
      if (!nextReactions[key].length) delete nextReactions[key];
    });
    let appliedReactions = nextReactions;
    if (isLiveMode()) {
      try {
        const saved = await services.chat.updateMessage(msgId, { reactions: { [emoji]: already ? [] : [user.uid] } });
        const persistedReactions = getPersistedReactions(saved);
        if (persistedReactions) {
          appliedReactions = persistedReactions;
        }
      } catch {
        toast('Не удалось обновить реакцию', 'error');
        return;
      }
    }
    updateMessage(msgId, { reactions: appliedReactions });
  }, [chat, user.uid, updateMessage]);

  const handleDeleteMsg = useCallback(async (id: string) => {
    try {
      if (isLiveMode()) {
        await services.chat.deleteMessage(id);
      }
    } catch {
      toast('Не удалось удалить', 'error');
      return;
    }
    deleteMessage(id);
  }, [deleteMessage]);

  const saveEdit = useCallback(async (id: string, newText: string) => {
    if (!newText.trim()) return;
    const patch = { text: newText.trim(), edited: true };
    try {
      if (isLiveMode()) {
        await services.chat.updateMessage(id, patch);
      }
    } catch {
      toast('Не удалось сохранить', 'error');
      setEditingMsg(null);
      return;
    }
    updateMessage(id, patch);
    setEditingMsg(null);
  }, [setEditingMsg, updateMessage]);

  const startReply = useCallback((message: ChatViewMessage) => {
    setReplyTo({
      id: message.id,
      name: getReplyName(message, user),
      text: message.text || (message.photo ? 'Фото' : ''),
      photo: message.photo || null,
    });
    setTimeout(focusComposer, 50);
  }, [focusComposer, setReplyTo, user]);

  const sendMessageEverywhere = useCallback(async (message: ChatViewMessage) => {
    const payload = toChatSendPayload(message);
    if (isLiveMode()) {
      const saved = await services.chat.sendMessage(payload);
      sendMessage(isPersistedChatMessage(saved) ? saved : message);
      return;
    }
    await services.chat.sendMessage({ ...payload, localMessage: message, sendLocal: sendMessage });
  }, [sendMessage]);

  const onTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>, message: ChatViewMessage) => {
    const touch = event.touches[0];
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, msgId: message.id, el: event.currentTarget, triggered: false };
  }, []);

  const onTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>, message: ChatViewMessage) => {
    const swipe = swipeRef.current;
    if (!swipe.startX || swipe.msgId !== message.id) return;
    const dx = event.touches[0].clientX - swipe.startX;
    const dy = Math.abs(event.touches[0].clientY - (swipe.startY || 0));
    if (dy > 20) {
      swipeRef.current = {};
      return;
    }
    if (dx > 0 && dx < 72 && swipe.el) {
      swipe.el.style.transform = 'translateX(' + Math.min(dx * 0.6, 40) + 'px)';
      swipe.el.classList.add('swiping');
    }
    if (dx > 55 && !swipe.triggered) {
      swipe.triggered = true;
      startReply(message);
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, [startReply]);

  const onTouchEnd = useCallback(() => {
    const swipe = swipeRef.current;
    if (swipe.el) {
      swipe.el.style.transform = '';
      swipe.el.classList.remove('swiping');
    }
    swipeRef.current = {};
  }, []);

  const onLongPressStart = useCallback((_event: React.TouchEvent<HTMLDivElement>, msgId: string) => {
    longPressRef.current = setTimeout(() => {
      setMsgMenu((prev) => (prev === msgId ? null : msgId));
      if (navigator.vibrate) navigator.vibrate(40);
    }, 500);
  }, []);

  const onLongPressEnd = useCallback(() => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }, []);

  const send = useCallback(async () => {
    if (!text.trim()) return;
    const message = {
      id: genId('m'),
      uid: user.uid,
      name: user.name,
      role: user.role,
      text: text.trim(),
      photo: null,
      replyTo: replyTo || null,
      at: new Date(),
    };
    try {
      await sendMessageEverywhere(message);
    } catch {
      toast('Не удалось отправить сообщение', 'error');
      return;
    }
    setText('');
    setReplyTo(null);
    focusComposer();
  }, [focusComposer, replyTo, sendMessageEverywhere, setReplyTo, setText, text, user]);

  const onPhotoClick = useCallback(() => {
    fileRef.current?.click();
    setShowTools(false);
  }, []);

  const insertEmoji = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    focusComposer();
  }, [focusComposer, setText]);

  const onFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast('Фото слишком большое (макс. 10 МБ)', 'error');
      return;
    }
    setPhotoSending(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (loadEvent) => resolve(String(loadEvent.target?.result || ''));
        reader.onerror = () => reject(new Error('fail'));
        reader.readAsDataURL(file);
      });
      const compressed = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const max = 800;
          const ratio = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
      const messageId = genId('m');
      let photoUrl = compressed;
      if (isLiveMode()) {
        const [uploadedUrl] = await services.requests.resolvePhotos(messageId, [compressed]);
        if (!uploadedUrl) throw new Error('photo upload failed');
        photoUrl = uploadedUrl;
      }
      const message = {
        id: messageId,
        uid: user.uid,
        name: user.name,
        role: user.role,
        text: '',
        photo: photoUrl,
        replyTo: replyTo || null,
        at: new Date(),
      };
      await sendMessageEverywhere(message);
      setReplyTo(null);
    } catch {
      toast('Не удалось загрузить фото', 'error');
    } finally {
      setPhotoSending(false);
    }
  }, [replyTo, sendMessageEverywhere, setReplyTo, user]);

  return (
    <div className="chat-wrap">
      {showSearch && (
        <div className="chat-search-row">
          <span className="chat-search-icon"><AppIcon name="search" size={14} /></span>
          <input
            className="search-inp chat-search-input"
            placeholder="Поиск в чате..."
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="modal-close u-shrink0" onClick={() => { setShowSearch(false); setSearchQuery(''); }} aria-label="Закрыть поиск"><AppIcon name="close" size={14} /></button>
        </div>
      )}
      <ChatMessageList
        msgsContainerRef={msgsContainerRef}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        historyError={historyError}
        onLoadOlder={loadOlderMessages}
        serverSearchLoading={serverSearchLoading}
        serverSearchError={serverSearchError}
        onRetryServerSearch={() => setSearchRetryTick((value) => value + 1)}
        initialHistoryError={initialHistoryError}
        onRetryInitialSync={retryInitialSync}
        filteredChatLength={filteredChat.length}
        searchQuery={searchQuery}
        renderMessages={() => (filteredChat as ChatViewMessage[]).map((message, index) => {
          const readStatus = getReadStatus(message);
          const dayKey = getDayKey(message.at);
          const prevMsg = filteredChat[index - 1];
          const showSep = !prevMsg || dayKey !== getDayKey(prevMsg.at);
          const replyTargetId = message.replyTo?.id;
          const quotedMsg = replyTargetId ? chat.find((entry) => entry.id === replyTargetId) || message.replyTo : null;
          const currentTs = msgTimestamps.get(message.id);
          const prevTs = prevMsg ? msgTimestamps.get(prevMsg.id) : undefined;
          const isGrouped = Boolean(
            prevMsg
            && !showSep
            && prevMsg.uid === message.uid
            && currentTs !== undefined
            && prevTs !== undefined
            && (currentTs - prevTs) < 300000,
          );
          return (
            <React.Fragment key={message.id}>
              {showSep && <div className="msg-date-sep"><span>{fmtDateSep(message.at)}</span></div>}
              <div
                className={'msg-row ' + (message.uid === user.uid ? 'mine' : '') + (isGrouped ? ' grouped' : '') + ' msg-row-rel'}
                onTouchStart={(event) => { onTouchStart(event, message); onLongPressStart(event, message.id); }}
                onTouchMove={(event) => { onTouchMove(event, message); onLongPressEnd(); }}
                onTouchEnd={() => { onTouchEnd(); onLongPressEnd(); }}
                onDoubleClick={() => startReply(message)}
              >
                {msgMenu === message.id && (
                  <>
                    <div
                      className="msg-menu-backdrop"
                      onClick={() => setMsgMenu(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setMsgMenu(null);
                      }}
                    />
                    <div
                      className="msg-menu-popup"
                      ref={menuPopupRef}
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                      onTouchEnd={(event) => event.stopPropagation()}
                      onTouchMove={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <button className="msg-menu-item" onMouseDown={(event) => event.stopPropagation()} onClick={() => { startReply(message); setMsgMenu(null); }}>↩ Ответить</button>
                      {can(user).editMessage(message) && !message.photo && (
                        <button className="msg-menu-item" onMouseDown={(event) => event.stopPropagation()} onClick={() => { setEditingMsg({ id: message.id, text: message.text || '' }); setMsgMenu(null); }}>
                          <AppIcon name="edit" className="u-inline-icon" /> Редактировать
                        </button>
                      )}
                      {can(user).deleteMessage(message) && (
                        <button className="msg-menu-item danger" onMouseDown={(event) => event.stopPropagation()} onClick={() => { setConfirmDeleteMsgId(message.id); setMsgMenu(null); }}>
                          <AppIcon name="trash" className="u-inline-icon" /> Удалить
                        </button>
                      )}
                      <div className="msg-menu-reactions">
                        {REACTIONS.map((emoji) => (
                          <button key={emoji} className="reaction-picker-btn" onMouseDown={(event) => event.stopPropagation()} onClick={() => { toggleReaction(message.id, emoji); setMsgMenu(null); }}>{emoji}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {message.uid !== user.uid && !isGrouped && (
                  <div className="msg-av msg-av-reset">
                    <AvatarCircle avData={users[message.uid]?.avatar || null} role={message.role} name={message.name || '?'} size={28} fontSize={11}/>
                  </div>
                )}
                {message.uid !== user.uid && isGrouped && <div className="msg-av-spacer"/>}
                <div>
                  <div
                    className={'msg-bubble ' + (message.uid === user.uid ? 'mine' : 'theirs')}
                    ref={(el) => {
                      if (el) msgRefs.current.set(message.id, el);
                      else msgRefs.current.delete(message.id);
                    }}
                  >
                    {message.uid !== user.uid && !isGrouped && (
                      <div className="msg-sender">
                        {(message.role === 'security' || message.role === 'concierge') ? ROLE_LABELS[message.role] : message.name}
                      </div>
                    )}
                    {quotedMsg && (
                      <div
                        className="msg-reply-quote"
                        role="button"
                        tabIndex={0}
                        aria-label="Перейти к цитируемому сообщению"
                        onClick={() => scrollToMsg(quotedMsg.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            scrollToMsg(quotedMsg.id);
                          }
                        }}
                      >
                        <div className="msg-reply-quote-name">{quotedMsg.name || message.replyTo?.name || 'Сообщение'}</div>
                        <div className="msg-reply-quote-text">{quotedMsg.photo ? 'Фото' : quotedMsg.text || message.replyTo?.text || ''}</div>
                      </div>
                    )}
                    {message.photo && (
                      <img
                        src={message.photo}
                        className="msg-photo"
                        alt="фото"
                        loading="lazy"
                        decoding="async"
                        role="button"
                        tabIndex={0}
                        aria-label="Открыть фото"
                        onClick={() => setLightbox(message.photo || null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setLightbox(message.photo || null);
                          }
                        }}
                      />
                    )}
                    {message.text && <div className="msg-text">{linkify(message.text)}</div>}
                    <div className="msg-time">
                      <span>{fmtTime(message.at)}</span>
                      {message.edited && <span className="msg-edited-mark">изменено</span>}
                      <CheckIcon status={readStatus}/>
                    </div>
                    <button className="msg-ctx-btn" onClick={(event) => { event.stopPropagation(); setMsgMenu((prev) => prev === message.id ? null : message.id); }} aria-label="Меню">⋯</button>
                  </div>
                  {editingMsg && editingMsg.id === message.id && (
                    <div className="msg-edit-wrap">
                      <textarea
                        className="msg-edit-inp"
                        rows={2}
                        value={editingMsg.text || ''}
                        onChange={(event) => setEditingMsg({ id: editingMsg.id, text: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            saveEdit(message.id, editingMsg.text || '');
                          }
                          if (event.key === 'Escape') setEditingMsg(null);
                        }}
                        autoFocus
                      />
                      <div className="msg-edit-hint"><span><kbd>Enter</kbd> сохранить</span><span><kbd>Esc</kbd> отменить</span></div>
                    </div>
                  )}
                  {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="msg-reactions">
                      {Object.entries(message.reactions).map(([emoji, uids]) => {
                        const safeUids = Array.isArray(uids) ? uids : [];
                        if (!safeUids.length) return null;
                        return (
                          <button key={emoji} className={'reaction-badge' + (safeUids.includes(user.uid) ? ' mine' : '')} onClick={() => toggleReaction(message.id, emoji)} title={safeUids.length + ' чел.'}>
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
        })}
        bottomRef={bottomRef}
      />
      {replyTo && (
        <div className="chat-reply-bar">
          <div className="chat-reply-bar-line"/>
          <div className="chat-reply-bar-body">
            <div className="chat-reply-bar-name">{replyTo.name}</div>
            <div className="chat-reply-bar-text">{replyTo.photo ? 'Фото' : replyTo.text}</div>
          </div>
          <button className="chat-reply-close" onClick={() => setReplyTo(null)} aria-label="Отменить ответ"><AppIcon name="close" size={14} /></button>
        </div>
      )}
      <div className="chat-bar">
        <div className="chat-tools" aria-label="Действия чата">
          <button className={'chat-photo-btn chat-tool-btn chat-tool-btn--plus ' + (showTools ? 'chat-btn--active' : 'chat-btn--default')} title="Действия" onClick={() => setShowTools((value) => !value)} aria-label="Открыть действия чата">
            <span className="chat-plus-glyph" aria-hidden="true">+</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={onFileChange}/>
          {showTools && (
            <div className="chat-tools-menu" role="menu" aria-label="Меню действий чата">
              <button className={'chat-tools-menu-btn ' + (showSearch ? 'chat-btn--active' : '')} onClick={() => { setShowSearch((value) => !value); setShowTools(false); }} role="menuitem">
                <AppIcon name="search" size={15} />
                <span>Поиск</span>
              </button>
              <button className="chat-tools-menu-btn" onClick={onPhotoClick} disabled={photoSending} role="menuitem">
                <AppIcon name={photoSending ? 'clock' : 'camera'} size={15} />
                <span>Фото</span>
              </button>
            </div>
          )}
        </div>
        <div className="chat-compose-shell">
          <textarea
            ref={inputRef}
            className="chat-inp"
            rows={1}
            placeholder="Напишите сообщение..."
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              syncComposerHeight();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button className={'chat-photo-btn chat-inline-emoji ' + (showEmoji ? 'chat-btn--active' : 'chat-btn--default')} onClick={() => setShowEmoji((value) => !value)} aria-label="Emoji">
            <AppIcon name="chat" size={16} />
          </button>
        </div>
        <button className="chat-send" onClick={() => void send()} disabled={!text.trim()} aria-label="Отправить сообщение"><AppIcon name="chevronRight" size={14} /></button>
      </div>
      {showEmoji && (
        <div className="emoji-picker">
          {EMOJI_GRID.map((emoji) => (
            <button key={emoji} className="emoji-pick-btn" onClick={() => insertEmoji(emoji)}>{emoji}</button>
          ))}
        </div>
      )}
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)}/>}
      {confirmDeleteMsgId && (
        <ConfirmDialog
          message="Удалить сообщение? Это действие нельзя отменить."
          confirmLabel="Удалить"
          onConfirm={() => { void handleDeleteMsg(confirmDeleteMsgId); setConfirmDeleteMsgId(null); }}
          onCancel={() => setConfirmDeleteMsgId(null)}
        />
      )}
    </div>
  );
}
