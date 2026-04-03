// ChatView извлечён из App.jsx (строки 2359–2646)
// Импорты добавлены вручную
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useActions, useChat, useUsers } from '../store/AppStore.jsx';
import { ROLE_LABELS } from '../constants/index.js';
import { fmtTime, genId } from '../utils.js';
import { AvatarCircle } from '../ui/AvatarCircle.jsx';
import { PhotoLightbox } from '../ui/PhotoLightbox.jsx';
import { toast } from '../ui/Toasts.jsx';
import { can } from '../domain/permissions';
import { services } from '../services/providers/serviceContainer';
import { isLiveMode } from '../config/runtimeMode.js';
import { AppIcon } from '../ui/AppIcon.jsx';
import StateBlock from '../ui/StateBlock.jsx';

// ─── Вспомогательные функции (вне компонента — не пересоздаются) ─────────────

// FIX [REACT-4]: вынесено из тела компонента — не пересоздаётся при каждом рендере
function fmtDateSep(date) {
  // FIX [PERF]: вычисляем todayTs/yesterdayTs один раз через числа, не через 4 Date-объекта
  const d = new Date(date);
  const now = new Date();
  // Сброс времени через арифметику: начало текущего дня
  const nowMidnight = now - (now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1_000 + now.getMilliseconds());
  const dMidnight = d - (d.getHours() * 3_600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds());
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

// FIX [REACT-4]: linkify вне компонента
function linkify(text) {
  const urlRx = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRx);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={part.slice(0, 20) + i} href={part} target="_blank" rel="noopener noreferrer" className="msg-link">{part}</a>
      : part
  );
}

// FIX [REACT-4]: CheckIcon вне компонента — не пересоздаётся при каждом рендере ChatView
// FIX [MEMO]: CheckIcon рендерится для каждого исходящего сообщения.
// Без memo перерисовывался при любом изменении chatLastSeen или отправке нового сообщения.
const CheckIcon = memo(function CheckIcon({ status }) {
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

export function ChatView({ user }) {
  const { chat, chatLastSeen } = useChat();
  const { sendMessage, markChatSeen, updateMessage, deleteMessage, setAllMessages } = useActions();
  const { users } = useUsers();
  const [text, setText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [photoSending, setPhotoSending] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [msgMenu, setMsgMenu] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  // P-05: подтверждение перед удалением сообщения — удаление необратимо
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState(null);
  // FIX [AUDIT]: пагинация истории чата.
  // Бэкенд всегда возвращал { messages, hasMore } — но фронт игнорировал hasMore.
  // Пользователь видел только последние 60 сообщений без возможности прокрутить дальше.
  const [hasMore, setHasMore]             = useState(false);
  const [loadingOlder, setLoadingOlder]   = useState(false);
  const msgsContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const swipeRef = useRef({});
  const longPressRef = useRef(null);
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
  const filteredChat = useMemo(() => {
    if (!searchQuery.trim()) return chat;
    const q = searchQuery.toLowerCase();
    return chat.filter(m => m.text?.toLowerCase().includes(q));
  }, [chat, searchQuery]);

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
  }, [chat.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX [AUDIT]: загрузка истории — «Загрузить ещё».
  // Бэкенд возвращал hasMore=true, но фронт его игнорировал — история была недоступна.
  // Алгоритм:
  //   1. Запрашиваем сообщения СТАРШЕ chat[0].id (oldest message in store).
  //   2. Сохраняем позицию скролла ДО добавления — после prepend скролл смещается.
  //   3. Prepend к текущему чату через setAllMessages.
  //   4. Восстанавливаем позицию скролла так чтобы пользователь видел то же место.
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || !isLiveMode()) return;
    const oldestMsg = chat[0];
    if (!oldestMsg) return;

    setLoadingOlder(true);
    const container = msgsContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    try {
      const data = await services.chat.getMessages({ before: oldestMsg.id, limit: 60 });
      if (data?.messages?.length) {
        // Prepend: старые сообщения идут перед текущими
        setAllMessages([...data.messages, ...chat]);
        setHasMore(data.hasMore ?? false);
        // Восстанавливаем позицию скролла — иначе пользователя бросает наверх
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch {
      // Не показываем ошибку — пользователь просто не увидит более старые сообщения
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMore, chat, setAllMessages]);

  // FIX [MEMORY]: markChatSeen при unmount не нужен — при открытии уже помечается
  useEffect(() => {
    markChatSeen(user.uid);
  }, [user.uid, markChatSeen]);

  // FIX [AUDIT]: синхронизируем hasMore при первой загрузке (live-режим).
  // useLiveSync вызывает setAllMessages при инициализации — результат содержит hasMore,
  // но setAllMessages принимает только массив сообщений.
  // Решение: при первом монтировании в live-режиме запрашиваем чат напрямую и берём hasMore.
  useEffect(() => {
    if (!isLiveMode()) return;
    let cancelled = false;
    services.chat.getMessages({ limit: 60 })
      .then(data => {
        if (cancelled) return;
        setHasMore(data?.hasMore ?? false);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- только при mount

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
    } catch (e) {
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
    } catch (e) {
      toast('Не удалось сохранить', 'error');
      setEditingMsg(null);
      return;
    }
    updateMessage(id, patch);
    setEditingMsg(null);
  }, [updateMessage]);

  // Ответ на сообщение
  const startReply = useCallback((m) => {
    setReplyTo({
      id: m.id,
      name: m.uid === user.uid ? 'Вы' : (m.role === 'security' || m.role === 'concierge' ? ROLE_LABELS[m.role] : m.name),
      text: m.text || (m.photo ? 'Фото' : ''),
      photo: m.photo || null,
    });
    inputRef.current && setTimeout(() => inputRef.current.focus(), 50);
  }, [user.uid]);

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
      setText(''); setReplyTo(null); inputRef.current?.focus();
    }
  }, [text, user, sendMessage, replyTo]);

  // FIX [PERF-15]: onPhotoClick и onFileChange пересоздавались при каждом рендере
  // (любое изменение text/photoSending). Их передают как onChange/onClick в DOM-элементы,
  // но пересоздание не вызывает ре-рендер нативного input — проблема в читаемости и
  // потенциальных будущих оборачиваниях в memo. Фиксируем явно.
  const onPhotoClick = useCallback(() => {
    fileRef.current?.click();
  }, []);

  // Вставка emoji в текстовое поле
  const insertEmoji = useCallback((emoji) => {
    setText(prev => prev + emoji);
    inputRef.current?.focus();
  }, []);

  const onFileChange = useCallback(async e => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    if (f.size > 10 * 1024 * 1024) { toast('Фото слишком большое (макс. 10 МБ)', 'error'); return; }
    setPhotoSending(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = ev => res(ev.target.result);
        r.onerror = () => rej(new Error('fail'));
        r.readAsDataURL(f);
      });
      const compressed = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const max = 800;
          const ratio = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
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
    } catch (err) {
      toast('Не удалось загрузить фото', 'error');
    } finally {
      setPhotoSending(false);
    }
  }, [user, sendMessage]);

  return (
    <div className="chat-wrap">
      {showSearch && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--b1)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--s0)' }}>
          <span style={{ fontSize: 14 }}><AppIcon name="search" size={14} /></span>
          <input className="search-inp" style={{ flex: 1, marginBottom: 0, fontSize: 13 }}
            placeholder="Поиск в чате..." autoFocus
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <button className="modal-close" style={{ flexShrink: 0 }} onClick={() => { setShowSearch(false); setSearchQuery(''); }} aria-label="Закрыть поиск"><AppIcon name="close" size={14} /></button>
        </div>
      )}
      <div className="chat-msgs" ref={msgsContainerRef}>
        {/* FIX [AUDIT]: кнопка «Загрузить ещё» — бэкенд возвращал hasMore,
            но фронт не предоставлял способа прогрузить историю старше 60 сообщений. */}
        {hasMore && (
          <div style={{ padding: '8px 0' }}>
            {loadingOlder ? (
              <StateBlock type="loading" title="Загрузка истории…" />
            ) : (
              <button
                onClick={loadOlderMessages}
                className="btn-outline"
                style={{ display: 'block', margin: '0 auto', minWidth: 160 }}
              >
                <span className="u-inline-icon"><AppIcon name="history" size={14} /> Загрузить ещё</span>
              </button>
            )}
          </div>
        )}
        {filteredChat.length === 0 && (
          <StateBlock
            type="empty"
            title={searchQuery ? 'Ничего не найдено' : 'Начните переписку'}
            subtitle={searchQuery ? 'Попробуйте изменить запрос' : 'Напишите первое сообщение в этом чате'}
          />
        )}
        {filteredChat.map((m, i) => {
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
                className={'msg-row ' + (m.uid === user.uid ? 'mine' : '') + (isGrouped ? ' grouped' : '')}
                style={{ position: 'relative' }}
                onTouchStart={e => { onTouchStart(e, m); onLongPressStart(e, m.id); }}
                onTouchMove={e => { onTouchMove(e, m); onLongPressEnd(); }}
                onTouchEnd={e => { onTouchEnd(e); onLongPressEnd(); }}
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
                  <div className="msg-av" style={{ flexShrink: 0, overflow: 'hidden', padding: 0 }}>
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
                      {Object.entries(m.reactions).map(([emoji, uids]) => uids.length > 0 && (
                        <button key={emoji} className={'reaction-badge' + (uids.includes(user.uid) ? ' mine' : '')} onClick={() => toggleReaction(m.id, emoji)} title={uids.length + ' чел.'}>
                          <span>{emoji}</span><span className="reaction-count">{uids.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef}/>
      </div>
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
        <button className="chat-photo-btn" title="Поиск" onClick={() => setShowSearch(s => !s)}
          style={{ background: showSearch ? 'var(--g-bg)' : 'var(--s2)', borderColor: showSearch ? 'var(--g1)' : 'var(--b1)' }}>
          <AppIcon name="search" size={16} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange}/>
        <button className="chat-photo-btn" onClick={onPhotoClick} disabled={photoSending} aria-label="Прикрепить фото">
          {photoSending ? <AppIcon name="history" size={16} /> : <AppIcon name="file" size={16} />}
        </button>
        <button className="chat-photo-btn" onClick={() => setShowEmoji(s => !s)} aria-label="Emoji"
          style={{ background: showEmoji ? 'var(--g-bg)' : 'var(--s2)', borderColor: showEmoji ? 'var(--g1)' : 'var(--b1)' }}>
          <AppIcon name="chat" size={16} />
        </button>
        <textarea ref={inputRef} className="chat-inp" rows={1}
          placeholder="Напишите сообщение..." value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
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
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Удалить сообщение?">
          <div className="confirm-panel">
            <p className="confirm-msg">Удалить сообщение? Это действие нельзя отменить.</p>
            <div className="confirm-actions">
              <button className="btn-no" onClick={() => { handleDeleteMsg(confirmDeleteMsgId); setConfirmDeleteMsgId(null); }}>Удалить</button>
              <button className="btn-outline" onClick={() => setConfirmDeleteMsgId(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
