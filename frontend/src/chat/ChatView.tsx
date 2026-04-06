// ChatView извлечён из App.jsx (строки 2359–2646)
// Импорты добавлены вручную
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useActions, useChat, useUsers } from '../store/AppStore';
import { ROLE_LABELS } from '../constants/index';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import { isLiveMode } from '../config/runtimeMode';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { services } from '../services/providers/serviceContainer';
import { toast } from '../ui/Toasts';
import { useChatSearch } from './hooks/useChatSearch';
import { useChatComposer } from './hooks/useChatComposer';
import { useChatData } from './hooks/useChatData';
import { useChatSend } from './hooks/useChatSend';
import { ChatMessageList } from './ChatMessageList';
import { ChatSearchBar } from './components/ChatSearchBar';
import { ChatReplyBar } from './components/ChatReplyBar';
import { ChatComposerBar } from './components/ChatComposerBar';
import { EmojiPicker } from './components/EmojiPicker';
import { ChatMessageItem } from './components/ChatMessageItem';

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

export function ChatView({ user }) {
  const { chat, chatLastSeen } = useChat();
  const { sendMessage, updateMessage, deleteMessage, setAllMessages } = useActions();
  const { users } = useUsers();
  const { text, setText, replyTo, setReplyTo, editingMsg, setEditingMsg, showEmoji, setShowEmoji } = useChatComposer();
  const [photoSending, setPhotoSending] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [msgMenu, setMsgMenu] = useState(null);
  // P-05: подтверждение перед удалением сообщения — удаление необратимо
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState(null);

  const msgsContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const swipeRef = useRef({});
  const longPressRef = useRef(null);

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
  } = useChatSearch(chat, hasMore, services.chat.getMessages);
  // FIX [BUG-20]: заменяем document.querySelector('[data-msg-id=...]') на ref-Map.
  const msgRefs = useRef(new Map()); // id → DOM-element

  // Утилита для скролла к сообщению по id — используется при клике на цитату
  const scrollToMsg = useCallback((id) => {
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
  const getReadStatus = useCallback((msg) => {
    if (msg.uid !== user.uid) return null;
    const msgTime = new Date(msg.at).getTime();
    if (otherUids.length === 0) return 'sent';
    return otherUids.every(uid => (chatLastSeen[uid] || 0) >= msgTime) ? 'read' : 'sent';
  }, [user.uid, otherUids, chatLastSeen]);

  // FIX [UX]: скролл только при добавлении новых сообщений, не при редактировании/реакциях.
  // [chat.length] — меняется только при добавлении/удалении сообщений.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  // FIX: Ref для popup — закрытие по клику вне меню
  const menuPopupRef = useRef(null);

  // FIX: Закрытие меню по клику вне popup (вместо backdrop-кнопки которая перехватывала клики)
  useEffect(() => {
    if (!msgMenu) return;
    function handleOutsideClick(e) {
      if (menuPopupRef.current && !menuPopupRef.current.contains(e.target)) {
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
    return () => { clearTimeout(longPressRef.current); };
  }, []);

  // Реакции
  const toggleReaction = useCallback(async (msgId, emoji) => {
    const msg = chat.find(m => m.id === msgId);
    if (!msg) return;
    const prev = msg.reactions || {};
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
  const handleDeleteMsg = useCallback(async (id) => {
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
  const saveEdit = useCallback(async (id, newText) => {
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
  const startReply = useCallback((m) => {
    setReplyTo({
      id: m.id,
      name: m.uid === user.uid ? 'Вы' : (m.role === 'security' || m.role === 'concierge' ? ROLE_LABELS[m.role] : m.name),
      text: m.text || (m.photo ? 'Фото' : ''),
      photo: m.photo || null,
    });
    if (inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [setReplyTo, user.uid]);

  // Свайп для ответа
  // FIX [PERF]: useCallback — эти обработчики вызываются на каждом сообщении;
  // без мемоизации создаётся N*4 новых функций при каждом рендере
  const onTouchStart = useCallback((e, m) => {
    const t = e.touches[0];
    swipeRef.current = { startX: t.clientX, startY: t.clientY, msgId: m.id, el: e.currentTarget, triggered: false };
  }, []);
  const onTouchMove = useCallback((e, m) => {
    const s = swipeRef.current;
    if (!s.startX || s.msgId !== m.id) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = Math.abs(e.touches[0].clientY - s.startY);
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
  const onLongPressStart = useCallback((e, msgId) => {
    longPressRef.current = setTimeout(() => {
      setMsgMenu(p => p === msgId ? null : msgId);
      if (navigator.vibrate) navigator.vibrate(40);
    }, 500);
  }, []);
  const onLongPressEnd = useCallback(() => clearTimeout(longPressRef.current), []);

  const { send, onPhotoClick, onFileChange, insertEmoji } = useChatSend({
    user,
    text,
    setText,
    replyTo,
    setReplyTo,
    inputRef,
    fileRef,
    sendMessage,
    setPhotoSending,
  });

  return (
    <div className="chat-wrap">
      {showSearch && (
        <ChatSearchBar
          searchQuery={searchQuery}
          onChange={setSearchQuery}
          onClose={() => { setShowSearch(false); setSearchQuery(''); }}
        />
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
        messages={filteredChat}
        renderMessage={(i) => {
          const m = filteredChat[i];
          const readStatus = getReadStatus(m);
          const dayKey = getDayKey(m.at);
          const prevMsg = filteredChat[i - 1];
          const showSep = !prevMsg || dayKey !== getDayKey(prevMsg.at);
          const quotedMsg = m.replyTo ? chat.find(x => x.id === m.replyTo.id) || m.replyTo : null;
          const isGrouped = prevMsg && !showSep && prevMsg.uid === m.uid && (msgTimestamps.get(m.id) - msgTimestamps.get(prevMsg.id)) < 300000;
          return (
            <ChatMessageItem
              key={m.id}
              m={m}
              showSep={showSep}
              dayLabel={fmtDateSep(m.at)}
              user={user}
              users={users}
              isGrouped={isGrouped}
              quotedMsg={quotedMsg}
              readStatus={readStatus}
              msgMenu={msgMenu}
              editingMsg={editingMsg}
              menuPopupRef={menuPopupRef}
              setMsgRef={(id, el) => {
                if (el) msgRefs.current.set(id, el);
                else msgRefs.current.delete(id);
              }}
              linkify={linkify}
              onSetLightbox={setLightbox}
              onScrollToMsg={scrollToMsg}
              onToggleMenu={id => setMsgMenu(p => p === id ? null : id)}
              onStartReply={startReply}
              onSetEditingMsg={setEditingMsg}
              onRequestDelete={setConfirmDeleteMsgId}
              onToggleReaction={toggleReaction}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingMsg(null)}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onLongPressStart={onLongPressStart}
              onLongPressEnd={onLongPressEnd}
              onCloseMenu={() => setMsgMenu(null)}
            />
          );
        }}
        bottomRef={bottomRef}
      />
      {replyTo && (
        <ChatReplyBar
          replyTo={replyTo}
          onClose={() => setReplyTo(null)}
        />
      )}
      <ChatComposerBar
        showSearch={showSearch}
        showEmoji={showEmoji}
        photoSending={photoSending}
        text={text}
        inputRef={inputRef}
        fileRef={fileRef}
        onToggleSearch={() => setShowSearch(s => !s)}
        onFileChange={onFileChange}
        onPhotoClick={onPhotoClick}
        onToggleEmoji={() => setShowEmoji(s => !s)}
        onTextChange={setText}
        onSend={send}
      />
      {showEmoji && (
        <EmojiPicker onPick={insertEmoji} />
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
