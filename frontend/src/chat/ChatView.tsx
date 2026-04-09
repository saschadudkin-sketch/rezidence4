// ChatView извлечён из App.jsx (строки 2359–2646)
// Импорты добавлены вручную
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

// ─── Вспомогательные функции (вне компонента — не пересоздаются) ─────────────

// FIX [REACT-4]: вынесено из тела компонента — не пересоздаётся при каждом рендере
function fmtDateSep(date) {
  // FIX [PERF]: вычисляем todayTs/yesterdayTs один раз через числа, не через 4 Date-объекта
  const d = new Date(date);
  const now = new Date();
  // Сброс времени через арифметику: начало текущего дня
  const nowMidnight = now.getTime() - (now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1_000 + now.getMilliseconds());
  const dMidnight = d.getTime() - (d.getHours() * 3_600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds());
  if (dMidnight === nowMidnight) return 'Сегодня';
  if (dMidnight === nowMidnight - 86_400_000) return 'Вчера';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ru-RU', sameYear
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDayKey(date) {
  return new Date(date).toDateString();
}

// T-07/SEC-04: linkify использует URL-конструктор для валидации вместо наивного regex.
// Это защищает от: URL со скобками, кавычками, спецсимволами, и нестандартных схем (javascript:).
// Разрешены только http: и https: — остальные схемы отображаются как текст.
function linkify(text) {
  // Более строгий regex — не захватывает закрывающие скобки/кавычки/знаки препинания в конце URL
  const urlRx = /\bhttps?:\/\/[^\s<>"'()[\]{}|\\^`]+/gi;
  const parts = text.split(urlRx);
  const matches = text.match(urlRx) || [];
  if (!matches.length) return text;
  return parts.flatMap((part, i) => {
    const url = matches[i - 1];
    if (i === 0) return [part];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [url, part];
      return [
        <a key={url.slice(0, 20) + i} href={parsed.href} target="_blank" rel="noopener noreferrer" className="msg-link">{url}</a>,
        part,
      ];
    } catch {
      // Невалидный URL — показываем как текст
      return [url, part];
    }
  });
}

// FIX [REACT-4]: CheckIcon вне компонента — не пересоздаётся при каждом рендере ChatView
// FIX [MEMO]: CheckIcon рендерится для каждого исходящего сообщения.
// Без memo перерисовывался при любом изменении chatLastSeen или отправке нового сообщения.
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

// Emoji picker — популярные emoji для быстрой вставки
const EMOJI_GRID = [
  '😀','😂','🤣','😊','😍','🥰','😘','😎','🤔','😏',
  '😢','😭','😤','🤬','😱','🥺','👋','👍','👎','👏',
  '🙏','💪','❤️','🔥','⭐','✅','❌','⚡','🎉','🏠',
  '🚗','📦','🔧','👷','🚕','📞','📸','🔑','🚪','⏰',
];

export function ChatView({ user }: { user: AppUser }) {
  const { chat, chatLastSeen } = useChat();
  const { sendMessage, updateMessage, deleteMessage, setAllMessages } = useActions();
  const { users } = useUsers();
  const { text, setText, replyTo, setReplyTo, editingMsg, setEditingMsg, showEmoji, setShowEmoji } = useChatComposer();
  const [photoSending, setPhotoSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [msgMenu, setMsgMenu] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  // P-05: подтверждение перед удалением сообщения — удаление необратимо
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);

  const msgsContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const swipeRef = useRef<SwipeState>({});
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // КРИТ-2: server-side search results — used when hasMore=true (local msgs are incomplete)
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
  // FIX [BUG-20]: заменяем document.querySelector('[data-msg-id=...]') на ref-Map.
  const msgRefs = useRef(new Map()); // id → DOM-element

  // Утилита для скролла к сообщению по id — используется при клике на цитату
  const scrollToMsg = useCallback((id: string) => {
    const el = msgRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 1200);
  }, []);

  // FIX [REACT-3]: filteredChat ПЕРЕД return (было после — используется в JSX)
  // КРИТ-2: prefer server results when hasMore=true (local store is incomplete).
  // FIX [PERF-4]: кешируем timestamp каждого сообщения — не создаём new Date() внутри map
  // При N сообщениях и каждом ре-рендере chat-bar это экономит 2N Date-аллокаций.
  const msgTimestamps = useMemo(
    () => new Map(filteredChat.map(m => [m.id, new Date(m.at).getTime()])),
    [filteredChat],
  );

  // FIX [PERF]: otherUids и getReadStatus мемоизированы — не пересчитываются при каждом рендере
  const otherUids = useMemo(
    () => Object.keys(users).filter(uid => uid !== user.uid),
    [users, user.uid],
  );
  const getReadStatus = useCallback((msg: ChatViewMessage): ReadStatus | null => {
    if (msg.uid !== user.uid) return null;
    const msgTime = new Date(msg.at).getTime();
    if (otherUids.length === 0) return 'sent';
    return otherUids.every(uid => (chatLastSeen[uid] || 0) >= msgTime) ? 'read' : 'sent';
  }, [user.uid, otherUids, chatLastSeen]);

  // FIX [UX]: скролл только при добавлении новых сообщений, не при редактировании/реакциях.
  // [chat.length] — меняется только при добавлении/удалении сообщений.
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

  // FIX: Ref для popup — закрытие по клику вне меню
  const menuPopupRef = useRef<HTMLDivElement | null>(null);

  // FIX: Закрытие меню по клику вне popup (вместо backdrop-кнопки которая перехватывала клики)
  useEffect(() => {
    if (!msgMenu) return;
    function handleOutsideClick(e: MouseEvent | TouchEvent) {
      const target = e.target;
      if (menuPopupRef.current && target instanceof Node && !menuPopupRef.current.contains(target)) {
        setMsgMenu(null);
      }
    }
    // setTimeout(0) — чтобы не закрыть меню от того же клика на ⋯ который его открыл
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

  // MEMORY-1: cleanup longPressRef on unmount to prevent memory leak
  useEffect(() => {
    return () => { if (longPressRef.current) clearTimeout(longPressRef.current); };
  }, []);

  // Реакции
  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    const msg = (chat as ChatViewMessage[]).find(m => m.id === msgId);
    if (!msg) return;
    const prev: Record<string, string[]> = msg.reactions || {};
    const uids = prev[emoji] || [];
    const already = uids.includes(user.uid);
    const newUids = already ? uids.filter(u => u !== user.uid) : [...uids, user.uid];
    const nr = { ...prev, [emoji]: newUids };
    Object.keys(nr).forEach(k => { if (!nr[k].length) delete nr[k]; });
    if (isLiveMode()) {
      try { await services.chat.updateMessage(msgId, { reactions: nr }); } catch { /* fallback local */ }
    }
    updateMessage(msgId, { reactions: nr });
  }, [chat, user.uid, updateMessage]);

  // Удаление сообщения — API + local
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

  // Сохранение редактирования — API + local
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

  // Ответ на сообщение
  const startReply = useCallback((m: ChatViewMessage) => {
    setReplyTo({
      id: m.id,
      name: m.uid === user.uid ? 'Вы' : (m.role === 'security' || m.role === 'concierge' ? ROLE_LABELS[m.role] : m.name),
      text: m.text || (m.photo ? 'Фото' : ''),
      photo: m.photo || null,
    });
    if (inputRef.current) {
      setTimeout(focusComposer, 50);
    }
  }, [focusComposer, setReplyTo, user.uid]);

  // Свайп для ответа
  // FIX [PERF]: useCallback — эти обработчики вызываются на каждом сообщении;
  // без мемоизации создаётся N*4 новых функций при каждом рендере
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, m: ChatViewMessage) => {
    const t = e.touches[0];
    swipeRef.current = { startX: t.clientX, startY: t.clientY, msgId: m.id, el: e.currentTarget, triggered: false };
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>, m: ChatViewMessage) => {
    const s = swipeRef.current;
    if (!s.startX || s.msgId !== m.id) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = Math.abs(e.touches[0].clientY - (s.startY || 0));
    if (dy > 20) { swipeRef.current = {}; return; }
    if (dx > 0 && dx < 72) {
      s.el.style.transform = 'translateX(' + Math.min(dx * 0.6, 40) + 'px)';
      s.el.classList.add('swiping');
    }
    if (dx > 55 && !s.triggered) {
      s.triggered = true;
      startReply(m);
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, [startReply]);
  const onTouchEnd = useCallback(() => {
    const s = swipeRef.current;
    if (s.el) { s.el.style.transform = ''; s.el.classList.remove('swiping'); }
    swipeRef.current = {};
  }, []);

  // Long press (мобиль) — открывает меню действий
  const onLongPressStart = useCallback((_e: React.TouchEvent<HTMLDivElement>, msgId: string) => {
    longPressRef.current = setTimeout(() => {
      setMsgMenu(p => p === msgId ? null : msgId);
      if (navigator.vibrate) navigator.vibrate(40);
    }, 500);
  }, []);
  const onLongPressEnd = useCallback(() => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }, []);

  // Отправка
  const send = useCallback(async () => {
    if (!text.trim()) return;
    const m = { id: genId('m'), uid: user.uid, name: user.name, role: user.role, text: text.trim(), photo: null, replyTo: replyTo || null, at: new Date() };
    try {
      await services.chat.sendMessage({
        remotePayload: { uid: user.uid, name: user.name, role: user.role, text: text.trim(), replyTo: replyTo || null },
        localMessage: m,
        sendLocal: sendMessage,
      });
    } finally {
      setText(''); setReplyTo(null); focusComposer();
    }
  }, [focusComposer, replyTo, sendMessage, setReplyTo, setText, text, user]);

  // FIX [PERF-15]: onPhotoClick и onFileChange пересоздавались при каждом рендере
  // (любое изменение text/photoSending). Их передают как onChange/onClick в DOM-элементы,
  // но пересоздание не вызывает ре-рендер нативного input — проблема в читаемости и
  // потенциальных будущих оборачиваниях в memo. Фиксируем явно.
  const onPhotoClick = useCallback(() => {
    fileRef.current?.click();
    setShowTools(false);
  }, []);

  // Вставка emoji в текстовое поле
  const insertEmoji = useCallback((emoji: string) => {
    setText(prev => prev + emoji);
    focusComposer();
  }, [focusComposer, setText]);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    if (f.size > 10 * 1024 * 1024) { toast('Фото слишком большое (макс. 10 МБ)', 'error'); return; }
    setPhotoSending(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = ev => res(String(ev.target?.result || ''));
        r.onerror = () => rej(new Error('fail'));
        r.readAsDataURL(f);
      });
      const compressed = await new Promise<string>(resolve => {
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
      const m = { id: genId('m'), uid: user.uid, name: user.name, role: user.role, text: '', photo: compressed, at: new Date() };
      await services.chat.sendMessage({
        remotePayload: { uid: user.uid, name: user.name, role: user.role, text: '', photo: compressed },
        localMessage: m,
        sendLocal: sendMessage,
      });
    } catch {
      toast('Не удалось загрузить фото', 'error');
    } finally {
      setPhotoSending(false);
    }
  }, [user, sendMessage]);

  return (
    <div className="chat-wrap">
      {showSearch && (
        <div className="chat-search-row">
          <span className="chat-search-icon"><AppIcon name="search" size={14} /></span>
          <input className="search-inp chat-search-input"
            placeholder="Поиск в чате..." autoFocus
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
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
        onRetryServerSearch={() => setSearchRetryTick(v => v + 1)}
        initialHistoryError={initialHistoryError}
        onRetryInitialSync={retryInitialSync}
        filteredChatLength={filteredChat.length}
        searchQuery={searchQuery}
        renderMessages={() => (filteredChat as ChatViewMessage[]).map((m, i) => {
          const readStatus = getReadStatus(m);
          // FIX [BUG-3]: prevMsg должен брать из filteredChat, а не из chat.
          // При активном поиске filteredChat — подмножество chat, и chat[i-1] указывал
          // на неверный элемент → неправильные разделители дат и группировка сообщений.
          const dayKey  = getDayKey(m.at);
          const prevMsg = filteredChat[i - 1];
          const showSep = !prevMsg || dayKey !== getDayKey(prevMsg.at);
          const quotedMsg = m.replyTo ? chat.find(x => x.id === m.replyTo.id) || m.replyTo : null;
          const isGrouped = prevMsg && !showSep && prevMsg.uid === m.uid && (msgTimestamps.get(m.id) - msgTimestamps.get(prevMsg.id)) < 300000;
          return (
            <React.Fragment key={m.id}>
              {showSep && <div className="msg-date-sep"><span>{fmtDateSep(m.at)}</span></div>}
              <div
                className={'msg-row ' + (m.uid === user.uid ? 'mine' : '') + (isGrouped ? ' grouped' : '') + ' msg-row-rel'}
                onTouchStart={e => { onTouchStart(e, m); onLongPressStart(e, m.id); }}
                onTouchMove={e => { onTouchMove(e, m); onLongPressEnd(); }}
                onTouchEnd={() => { onTouchEnd(); onLongPressEnd(); }}
                onDoubleClick={() => startReply(m)}
              >
                {msgMenu === m.id && (<>
                  <div className="msg-menu-backdrop" onClick={() => setMsgMenu(null)}/>
                  <div className="msg-menu-popup" ref={menuPopupRef}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    onTouchEnd={e => e.stopPropagation()}
                    onTouchMove={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}>
                    <button className="msg-menu-item" onMouseDown={e => e.stopPropagation()} onClick={() => { startReply(m); setMsgMenu(null); }}>↩ Ответить</button>
                    {can(user).editMessage(m) && !m.photo && <button className="msg-menu-item" onMouseDown={e => e.stopPropagation()} onClick={() => { setEditingMsg({ id: m.id, text: m.text }); setMsgMenu(null); }}><AppIcon name="edit" className="u-inline-icon" /> Редактировать</button>}
                    {can(user).deleteMessage(m) && <button className="msg-menu-item danger" onMouseDown={e => e.stopPropagation()} onClick={() => { setConfirmDeleteMsgId(m.id); setMsgMenu(null); }}><AppIcon name="trash" className="u-inline-icon" /> Удалить</button>}
                    <div className="msg-menu-reactions">
                      {REACTIONS.map(emoji => (
                        <button key={emoji} className="reaction-picker-btn" onMouseDown={e => e.stopPropagation()} onClick={() => { toggleReaction(m.id, emoji); setMsgMenu(null); }}>{emoji}</button>
                      ))}
                    </div>
                  </div>
                </>)}
                {m.uid !== user.uid && !isGrouped && (
                  <div className="msg-av msg-av-reset">
                    <AvatarCircle avData={(users[m.uid] && users[m.uid].avatar) || null} role={m.role} name={m.name || '?'} size={28} fontSize={11}/>
                  </div>
                )}
                {m.uid !== user.uid && isGrouped && <div className="msg-av-spacer"/>}
                <div>
                  <div
                    className={'msg-bubble ' + (m.uid === user.uid ? 'mine' : 'theirs')}
                    ref={el => {
                      // FIX [BUG-20]: регистрируем элемент в Map при монтировании,
                      // удаляем при размонтировании (el === null)
                      if (el) msgRefs.current.set(m.id, el);
                      else    msgRefs.current.delete(m.id);
                    }}
                  >
                    {m.uid !== user.uid && !isGrouped && (
                      <div className="msg-sender">
                        {(m.role === 'security' || m.role === 'concierge') ? ROLE_LABELS[m.role] : m.name}
                      </div>
                    )}
                    {quotedMsg && (
                      <div className="msg-reply-quote" role="button" tabIndex={0}
                        aria-label="Перейти к цитируемому сообщению"
                        onClick={() => scrollToMsg(quotedMsg.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            scrollToMsg(quotedMsg.id);
                          }
                        }}>
                        <div className="msg-reply-quote-name">{quotedMsg.name || m.replyTo?.name}</div>
                        <div className="msg-reply-quote-text">{quotedMsg.photo ? 'Фото' : quotedMsg.text || m.replyTo?.text}</div>
                      </div>
                    )}
                    {m.photo && <img src={m.photo} className="msg-photo" alt="фото" onClick={() => setLightbox(m.photo)}/>}
                    {m.text && <div className="msg-text">{linkify(m.text)}</div>}
                    <div className="msg-time">
                      <span>{fmtTime(m.at)}</span>
                      {m.edited && <span className="msg-edited-mark">изменено</span>}
                      <CheckIcon status={readStatus}/>
                    </div>
                    <button className="msg-ctx-btn" onClick={e => { e.stopPropagation(); setMsgMenu(p => p === m.id ? null : m.id); }} aria-label="Меню">⋯</button>
                  </div>
                  {editingMsg && editingMsg.id === m.id && (
                    <div className="msg-edit-wrap">
                      <textarea className="msg-edit-inp" rows={2} value={editingMsg.text}
                        onChange={e => setEditingMsg({ id: editingMsg.id, text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m.id, editingMsg.text); }
                          if (e.key === 'Escape') { setEditingMsg(null); }
                        }}
                        autoFocus/>
                      <div className="msg-edit-hint"><span><kbd>Enter</kbd> сохранить</span><span><kbd>Esc</kbd> отменить</span></div>
                    </div>
                  )}
                  {m.reactions && Object.keys(m.reactions).length > 0 && (
                    <div className="msg-reactions">
                      {Object.entries(m.reactions).map(([emoji, uids]) => {
                        const safeUids = Array.isArray(uids) ? uids : [];
                        if (!safeUids.length) return null;
                        return (
                        <button key={emoji} className={'reaction-badge' + (safeUids.includes(user.uid) ? ' mine' : '')} onClick={() => toggleReaction(m.id, emoji)} title={safeUids.length + ' чел.'}>
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
          <button className={'chat-photo-btn chat-tool-btn chat-tool-btn--plus ' + (showTools ? 'chat-btn--active' : 'chat-btn--default')} title="Действия" onClick={() => setShowTools(s => !s)} aria-label="Открыть действия чата">
            <span className="chat-plus-glyph" aria-hidden="true">+</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={onFileChange}/>
          {showTools && (
            <div className="chat-tools-menu" role="menu" aria-label="Меню действий чата">
              <button className={'chat-tools-menu-btn ' + (showSearch ? 'chat-btn--active' : '')} onClick={() => { setShowSearch(s => !s); setShowTools(false); }} role="menuitem">
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
          <textarea ref={inputRef} className="chat-inp" rows={1}
            placeholder="Напишите сообщение..." value={text}
            onChange={e => {
              setText(e.target.value);
              syncComposerHeight();
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className={'chat-photo-btn chat-inline-emoji ' + (showEmoji ? 'chat-btn--active' : 'chat-btn--default')} onClick={() => setShowEmoji(s => !s)} aria-label="Emoji">
            <AppIcon name="chat" size={16} />
          </button>
        </div>
        <button className="chat-send" onClick={send} disabled={!text.trim()} aria-label="Отправить сообщение"><AppIcon name="chevronRight" size={14} /></button>
      </div>
      {showEmoji && (
        <div className="emoji-picker">
          {EMOJI_GRID.map(em => (
            <button key={em} className="emoji-pick-btn" onClick={() => insertEmoji(em)}>{em}</button>
          ))}
        </div>
      )}
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)}/>}
      {/* P-05: подтверждение удаления сообщения — удаление необратимо */}
      {confirmDeleteMsgId && (
        <ConfirmDialog
          message="Удалить сообщение? Это действие нельзя отменить."
          confirmLabel="Удалить"
          onConfirm={() => { handleDeleteMsg(confirmDeleteMsgId); setConfirmDeleteMsgId(null); }}
          onCancel={() => setConfirmDeleteMsgId(null)}
        />
      )}
    </div>
  );
}
