import { useState, useEffect, useRef } from 'react';
import { useActions, usePerms } from '../store/AppStore.jsx';
import { useIsMounted } from './useIsMounted.js';
import { genId } from '../utils.js';
import { toast } from '../ui/Toasts';
import { toastBySyncResult } from '../ui/syncFeedback';
import { lockScroll, unlockScroll } from '../ui/scrollLock.js';
import { services } from '../services/providers/serviceContainer';
import { parseLocalDateInputValue } from '../utils/dateInput';
import { usePhotoHandler } from './usePhotoHandler.js';
import { useScheduleForm, fmtScheduled } from './useScheduleForm.js';
import { useTemplateForm } from './useTemplateForm.js';

// Re-export date utilities consumed by CreateModal and other importers.
export { toLocalDateInputValue, toLocalDateTimeInputValue, parseLocalDateInputValue } from '../utils/dateInput';

// Re-export scheduling helpers consumed by CreateModal.
export { fmtScheduled, minDateTime, SCHEDULE_PRESETS } from './useScheduleForm.js';

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

// ─── Хук ─────────────────────────────────────────────────────────────────────

/**
 * useCreateRequest — координирует форму создания заявки.
 * A-03: decomposed into sub-hooks:
 *   usePhotoHandler  — photo state, compress, upload
 *   useScheduleForm  — schedule toggle, presets
 *   useTemplateForm  — template save UI
 * CreateModal остаётся чистым «шаблоном» без бизнес-логики.
 */
export function useCreateRequest({ user, type, initialCat, initialData, onClose, onDone }) {
  const cats = type === 'pass'
    ? (user.role === 'contractor'
        ? ['worker', 'team', 'delivery', 'car']
        : ['guest', 'courier', 'taxi', 'car', 'master'])
    : ['electrician', 'plumber'];

  // ── Состояние формы ─────────────────────────────────────────────────────
  const [cat,      setCat]      = useState(initialData?.category    || initialCat || cats[0]);
  const [vName,    setVName]    = useState(initialData?.visitorName  || '');
  const [vNames,   setVNames]   = useState(() =>
    initialData?.visitorName
      ? [{ __id: genId(), value: initialData.visitorName }]
      : [{ __id: genId(), value: '' }]
  );
  const [vPhone,   setVPhone]   = useState(initialData?.visitorPhone || '');
  const [carPlate, setCarPlate] = useState(initialData?.carPlate    || '');
  const [comment,  setComment]  = useState(initialData?.comment     || '');
  // P-05: passDuration state removed — derived from validUntil at submit time
  const [validUntil, setValidUntil] = useState(initialData?.validUntil || '');
  const [loading,    setLoading]    = useState(false);

  // ── Выбор из списка ─────────────────────────────────────────────────────
  const [showPermsPicker, setShowPermsPicker] = useState(false);

  const { addTemplate, addRequest, deleteRequest, updateRequest } = useActions();
  const userPerms = usePerms(user.uid);

  const permsList = canUsePermsList(type, cat)
    ? (user.role === 'contractor' ? userPerms.workers : userPerms.visitors)
    : [];

  // FE-02: useIsMounted replaces inline isMountedRef pattern
  const isMountedRef = useIsMounted();
  // D-01: double-submit guard — ref is synchronous unlike state (setLoading)
  const submittingRef = useRef(false);

  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  // Reset visitor fields on category change
  // FIX [REACT]: prev-value ref pattern avoids triggering on mount
  const prevCatRef = useRef(cat);
  useEffect(() => {
    if (prevCatRef.current === cat) return;
    prevCatRef.current = cat;
    // P-04: fix type bug — setVNames expects [{__id, value}] objects, not plain strings
    setVName(''); setVPhone(''); setCarPlate(''); setVNames([{ __id: genId(), value: '' }]);
  }, [cat]);

  // ── Sub-hooks ────────────────────────────────────────────────────────────
  const { photos, handlePhoto, removePhoto } = usePhotoHandler(isMountedRef);
  const { showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset } = useScheduleForm();
  const { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl } = useTemplateForm({
    type, cat, vName, vNames, vPhone, carPlate, comment, uid: user.uid, addTemplate,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePickPerm = (perm) => {
    setVName(perm.name);
    if (perm.phone) setVPhone(perm.phone);
    setShowPermsPicker(false);
  };

  const handleSubmit = async () => {
    // D-01: sync guard prevents double-submit
    if (submittingRef.current) return;

    // Validation
    if (type === 'pass' && cat === 'taxi'  && !carPlate.trim())                     { toast('Укажите марку и номер авто', 'error');  return; }
    if (type === 'pass' && cat === 'team'  && !vNames.some(n => n.value.trim()))    { toast('Укажите имена посетителей', 'error'); return; }
    if (type === 'pass' && requiresVisitorName(cat) && !vName.trim())               { toast('Укажите имя посетителя',    'error');  return; }

    submittingRef.current = true;
    setLoading(true);

    const schedDate      = showSchedule && scheduledFor ? new Date(scheduledFor) : null;
    const isScheduled    = Boolean(schedDate && schedDate > new Date());
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
                   : cat  === 'team'       ? vNames.filter(n => n.value.trim()).map(n => n.value).join(', ') || null
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

    try {
      // FIX [BUG-1] + [UX-2]: Optimistic update — add to store immediately with _pending flag
      const tempId = newReq.id;

      if (photos.length > 0) {
        newReq.photos = await services.requests.resolvePhotos(tempId, photos);
        newReq.photo  = newReq.photos[0] || null;
      }

      // FIX [AUDIT-4]: check isMounted after every await
      if (!isMountedRef.current) return;

      addRequest({ ...newReq, _pending: true });

      const mode = await services.requests.submit({ request: newReq, addLocal: () => {} });

      if (!isMountedRef.current) {
        updateRequest(tempId, { _pending: false });
        return;
      }

      if (mode && typeof mode === 'object' && mode.id) {
        deleteRequest(tempId);
        addRequest(mode);
      } else {
        updateRequest(tempId, { _pending: false });
      }

      submittingRef.current = false;
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
      // FIX [UX-2]: rollback optimistic update on server error
      deleteRequest(newReq.id);
      submittingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        toast('Ошибка при отправке заявки: ' + (e.message || 'попробуйте снова'), 'error');
      }
    }
  };

  return {
    // Form fields
    cats, cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    comment, setComment,
    validUntil, setValidUntil,
    photos, removePhoto,
    loading,
    permsList,

    // Templates (useTemplateForm)
    showSaveTpl, setShowSaveTpl,
    tplName, setTplName,

    // Schedule (useScheduleForm)
    showSchedule, setShowSchedule,
    scheduledFor, setScheduledFor,

    // Perms picker
    showPermsPicker, setShowPermsPicker,

    // Handlers
    handlePhoto,
    applyPreset,
    handleSaveTpl,
    handlePickPerm,
    handleSubmit,
  };
}
