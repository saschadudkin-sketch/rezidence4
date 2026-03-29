import { useState, useEffect, useRef } from 'react';
import { useActions, usePerms } from '../store/AppStore.jsx';
import { genId } from '../utils.js';
import { toast } from '../ui/Toasts';
import { toastBySyncResult } from '../ui/syncFeedback';
import { lockScroll, unlockScroll } from '../ui/scrollLock.js';
import { services } from '../services/providers/serviceContainer';
import { toLocalDateTimeInputValue, parseLocalDateInputValue } from '../utils/dateInput';

// Эти утилиты нужны компонентам, импортирующим их из этого файла (CreateModal и др.).
// Явный re-export с комментарием о происхождении — лучше, чем молчаливый транзитный экспорт.
// TODO: перевести CreateModal и остальных импортёров напрямую на '../utils/dateInput'.
export { toLocalDateInputValue, toLocalDateTimeInputValue, parseLocalDateInputValue } from '../utils/dateInput';

// ─── Предикаты категорий ─────────────────────────────────────────────────────

/** Нужно ли поле «марка и номер авто» */
export const needsCarPlate = (cat) =>
  ['taxi', 'car', 'master', 'delivery'].includes(cat);

/** Нужно ли обязательное имя посетителя */
export const requiresVisitorName = (cat) =>
  !['taxi', 'car', 'master', 'team', 'courier'].includes(cat);

/** Показывать ли поля посетителя вообще */
export const hasVisitorFields = (cat) =>
  cat !== 'taxi' && cat !== 'team';

/** Может ли категория использовать постоянный список */
export const canUsePermsList = (type, cat) =>
  type === 'pass' && !['taxi', 'team', 'courier'].includes(cat);

// ─── Сжатие изображения ──────────────────────────────────────────────────────

const compressImage = (dataUrl, maxWidth = 1024, quality = 0.72) =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale  = Math.min(1, maxWidth / img.width);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      // FIX: getContext('2d') может вернуть null в Safari при превышении лимита
      // одновременных canvas-контекстов (~16 на странице). Без проверки →
      // TypeError: Cannot read properties of null (reading 'drawImage').
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; } // graceful degradation — оригинал
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// ─── Форматирование запланированной даты ─────────────────────────────────────

export const fmtScheduled = (s) => {
  if (!s) return '';
  const d    = new Date(s);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString())
    return 'Сегодня в ' + time;
  if (d.toDateString() === new Date(Date.now() + 86_400_000).toDateString())
    return 'Завтра в ' + time;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' в ' + time;
};

export const minDateTime = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return toLocalDateTimeInputValue(d);
};

export const SCHEDULE_PRESETS = [
  { label: 'Через 1 час',       mins: 60  },
  { label: 'Через 2 часа',      mins: 120 },
  { label: 'Сегодня в 18:00',   fn: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; } },
  { label: 'Завтра утром',       fn: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
];

// ─── Хук ─────────────────────────────────────────────────────────────────────

/**
 * useCreateRequest — вся логика формы создания заявки.
 * CreateModal становится чистым «шаблоном» без бизнес-логики.
 */
export function useCreateRequest({ user, type, initialCat, initialData, onClose, onDone }) {
  const cats = type === 'pass'
    ? (user.role === 'contractor'
        ? ['worker', 'team', 'delivery', 'car']
        : ['guest', 'courier', 'taxi', 'car', 'master'])
    : ['electrician', 'plumber'];

  // ── Состояние формы ─────────────────────────────────────────────────────
  const [cat,      setCat]      = useState(initialData?.category  || initialCat || cats[0]);
  const [vName,    setVName]    = useState(initialData?.visitorName  || '');
  const [vNames,   setVNames]   = useState(initialData?.visitorName ? [initialData.visitorName] : ['']);
  const [vPhone,   setVPhone]   = useState(initialData?.visitorPhone || '');
  const [carPlate, setCarPlate] = useState(initialData?.carPlate   || '');
  const [comment,  setComment]  = useState(initialData?.comment    || '');
  const [passDuration, setPassDuration] = useState(initialData?.passDuration || 'once');
  const [validUntil,   setValidUntil]   = useState(initialData?.validUntil   || '');
  const [photos,   setPhotos]   = useState([]);
  const [loading,  setLoading]  = useState(false);

  // ── Шаблоны ─────────────────────────────────────────────────────────────
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName,     setTplName]     = useState('');

  // ── Расписание ──────────────────────────────────────────────────────────
  const [showSchedule,  setShowSchedule]  = useState(false);
  const [scheduledFor,  setScheduledFor]  = useState('');

  // ── Выбор из списка ─────────────────────────────────────────────────────
  const [showPermsPicker, setShowPermsPicker] = useState(false);

  const { addTemplate, addRequest, deleteRequest, updateRequest } = useActions();
  const userPerms = usePerms(user.uid);

  // Постоянный список для подстановки
  const permsList = canUsePermsList(type, cat)
    ? (user.role === 'contractor' ? userPerms.workers : userPerms.visitors)
    : [];

  // FIX [AUDIT-4]: isMountedRef — handleSubmit делает async операции (фото, API).
  // Если пользователь закроет модал пока запрос летит, setState на unmounted компоненте
  // вызывал warning и потенциальный side-effect (двойная запись в стор).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    lockScroll();
    return () => {
      isMountedRef.current = false;
      unlockScroll();
    };
  }, []);

  // Сброс полей при смене категории
  // FIX [REACT]: isFirstRender ref antipattern заменён на useRef с предыдущим значением.
  // Эффект срабатывает при ИЗМЕНЕНИИ cat — не при монтировании.
  const prevCatRef = useRef(cat);
  useEffect(() => {
    if (prevCatRef.current === cat) return; // монтирование — пропускаем
    prevCatRef.current = cat;
    setVName(''); setVPhone(''); setCarPlate(''); setVNames(['']);
  }, [cat]);

  // ── Обработчики ─────────────────────────────────────────────────────────

  const handlePhoto = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 5 - photos.length;
    if (remaining <= 0) { toast('Максимум 5 фото', 'error'); return; }
    const toProcess = files.slice(0, remaining);
    if (files.length > remaining) toast(`Добавлено ${remaining} из ${files.length} фото (макс. 5)`, 'info');

    const oversized = toProcess.some(f => f.size > 10 * 1024 * 1024);
    if (oversized) { toast('Фото слишком большое (макс. 10 МБ)', 'error'); return; }

    try {
      const results = await Promise.all(
        toProcess.map(f => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            try { resolve(await compressImage(ev.target.result)); }
            catch (err) { reject(err); }
          };
          reader.onerror = () => reject(new Error('Не удалось загрузить фото'));
          reader.readAsDataURL(f);
        }))
      );
      // FIX [LEAK]: модал может закрыться пока файлы читались (медленный диск)
      if (isMountedRef.current) setPhotos(prev => [...prev, ...results].slice(0, 5));
    } catch {
      if (isMountedRef.current) toast('Не удалось загрузить фото', 'error');
    }
    e.target.value = '';
  };

  const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const applyPreset = (preset) => {
    const d = preset.fn ? preset.fn() : new Date(Date.now() + preset.mins * 60_000);
    d.setSeconds(0, 0);
    setScheduledFor(toLocalDateTimeInputValue(d));
  };

  const handleSaveTpl = () => {
    if (!tplName.trim()) { toast('Введите название шаблона', 'error'); return; }
    addTemplate(user.uid, {
      id:          genId('t'),
      name:        tplName.trim(),
      type,
      category:    cat,
      visitorName: cat === 'taxi' ? '' : cat === 'team'
                     ? vNames.filter(n => n.trim()).join(', ')
                     : vName,
      visitorPhone: vPhone,
      carPlate,
      comment,
    });
    setTplName('');
    setShowSaveTpl(false);
    toast('Шаблон «' + tplName.trim() + '» сохранён', 'success');
  };

  const handlePickPerm = (perm) => {
    setVName(perm.name);
    if (perm.phone) setVPhone(perm.phone);
    setShowPermsPicker(false);
  };

  const handleSubmit = async () => {
    // Валидация
    if (type === 'pass' && cat === 'taxi'  && !carPlate.trim())              { toast('Укажите марку и номер авто', 'error');  return; }
    if (type === 'pass' && cat === 'team'  && !vNames.some(n => n.trim()))   { toast('Укажите имена посетителей', 'error'); return; }
    if (type === 'pass' && requiresVisitorName(cat) && !vName.trim())        { toast('Укажите имя посетителя',     'error');  return; }

    setLoading(true);

    const schedDate   = showSchedule && scheduledFor ? new Date(scheduledFor) : null;
    const isScheduled = Boolean(schedDate && schedDate > new Date());
    const parsedValidUntil = type === 'pass' && validUntil ? parseLocalDateInputValue(validUntil) : null;
    if (type === 'pass' && validUntil && !parsedValidUntil) {
      if (isMountedRef.current) setLoading(false);
      toast('Некорректная дата действия пропуска', 'error');
      return;
    }

    const newReq = {
      id:            genId('r'),
      type,
      category:      cat,
      createdByUid:  user.uid,
      createdByRole: user.role,
      createdByName: user.name,
      createdByApt:  user.apartment,
      visitorName:   type !== 'pass'       ? null
                   : cat  === 'taxi'       ? null
                   : cat  === 'team'       ? vNames.filter(n => n.trim()).join(', ') || null
                   : vName.trim()          || null,
      carPlate:      needsCarPlate(cat)    ? carPlate.trim() || null : null,
      visitorPhone:  type === 'pass'       ? vPhone.trim()   || null : null,
      comment:       comment.trim(),
      priority:      'normal',
      passDuration:  type === 'pass' ? (validUntil ? 'temporary' : 'once') : null,
      validUntil:    parsedValidUntil,
      photo:         null,
      photos:        [],
      status:        isScheduled ? 'scheduled' : 'pending',
      createdAt:     new Date(),
      arrivedAt:     null,
      scheduledFor:  schedDate,
    };

    // Загрузка фото и отправка
    try {
      // FIX [BUG-1] + [UX-2]: Optimistic update — добавляем заявку в стор немедленно
      // с временным id и флагом _pending. После ответа сервера заменяем на серверный объект.
      // При ошибке — откатываем (удаляем из стора).
      const tempId = newReq.id; // клиентский genId — только для optimistic UI

      if (photos.length > 0) {
        newReq.photos = await services.requests.resolvePhotos(tempId, photos);
        newReq.photo = newReq.photos[0] || null;
      }

      // FIX [AUDIT-4]: проверяем isMounted после каждого await — модал мог закрыться
      // пока грузились фото (долгая загрузка на медленном соединении).
      if (!isMountedRef.current) return;

      // Optimistic: показываем заявку сразу с _pending флагом
      addRequest({ ...newReq, _pending: true });

      const mode = await services.requests.submit({ request: newReq, addLocal: () => {} });

      if (!isMountedRef.current) {
        // Модал закрыт, но заявка уже в сторе — убираем _pending флаг без UI обновлений
        updateRequest(tempId, { _pending: false });
        return;
      }

      if (mode && typeof mode === 'object' && mode.id) {
        // Live-режим: сервер вернул объект — заменяем временную запись серверной
        deleteRequest(tempId);
        addRequest(mode);
      } else if (mode === 'local' || mode === 'offline') {
        // Demo / offline — убираем _pending флаг
        updateRequest(tempId, { _pending: false });
      } else {
        updateRequest(tempId, { _pending: false });
      }

      setLoading(false);
      const successMsg = isScheduled
        ? 'Запланировано на ' + fmtScheduled(scheduledFor)
        : type === 'pass' ? 'Пропуск создан' : 'Заявка отправлена';
      toastBySyncResult(
        typeof mode === 'string' ? mode : 'synced',
        successMsg,
        'Заявка сохранена локально. Синхронизация будет повторена позже',
      );
      onDone();
      onClose();
    } catch(e) {
      // FIX [UX-2]: откат optimistic update при ошибке сервера
      deleteRequest(newReq.id);
      if (isMountedRef.current) {
        setLoading(false);
        toast('Ошибка при отправке заявки: ' + (e.message || 'попробуйте снова'), 'error');
      }
    }
  };

  return {
    // Данные формы
    cats, cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    comment, setComment,
    passDuration, setPassDuration,
    validUntil, setValidUntil,
    photos, removePhoto,
    loading,
    permsList,

    // Шаблоны
    showSaveTpl, setShowSaveTpl,
    tplName, setTplName,

    // Расписание
    showSchedule, setShowSchedule,
    scheduledFor, setScheduledFor,

    // Выбор из списка
    showPermsPicker, setShowPermsPicker,

    // Обработчики
    handlePhoto,
    applyPreset,
    handleSaveTpl,
    handlePickPerm,
    handleSubmit,
  };
}
