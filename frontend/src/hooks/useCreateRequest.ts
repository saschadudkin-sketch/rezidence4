import { useState, useEffect, useRef } from 'react';
import { useActions, usePerms } from '../store/AppStore';
import { useIsMounted } from './useIsMounted';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { presentError } from '../ui/errorPresenter';
import { toastBySyncResult } from '../ui/syncFeedback';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { services } from '../services/providers/serviceContainer';
import { parseLocalDateInputValue, toLocalDateInputValue, toLocalDateTimeInputValue } from '../utils/dateInput';
import { usePhotoHandler } from './usePhotoHandler';
import { useScheduleForm, fmtScheduled } from './useScheduleForm';
import { useTemplateForm } from './useTemplateForm';
import { sanitizeRequestFormFields } from '../utils/formPolicy';
// КРИТ-A1: form field state extracted to its own hook as part of God Hook decomposition
import { useRequestFormState } from './useRequestFormState';
import type { AppRequest, RequestStatus } from '../store/slices/requestsSlice';

// ─── Предикаты категорий ─────────────────────────────────────────────────────

/** Нужно ли поле «марка и номер авто» */
export const needsCarPlate = (cat) =>
  ['guest', 'taxi', 'car', 'master', 'delivery'].includes(cat);

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
  // КРИТ-A1: form field state delegated to useRequestFormState (decomposition step 1)
  const {
    cats, cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    comment, setComment,
    validUntil, setValidUntil,
  } = useRequestFormState({ type, user, initialCat, initialData });

  // P-05: passDuration state removed — derived from validUntil at submit time
  const [loading, setLoading] = useState(false);

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

  // ── Sub-hooks ────────────────────────────────────────────────────────────
  const { photos, handlePhoto, removePhoto } = usePhotoHandler(isMountedRef);
  const { showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset } = useScheduleForm();
  const { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl } = useTemplateForm({
    type, cat, vName, vNames, vPhone, carPlate, comment, uid: user.uid, addTemplate,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePickPerm = (perm) => {
    if (cat === 'guest') {
      setVNames((current) => {
        const nextNames = current.filter((entry) => entry.value.trim());
        if (nextNames.some((entry) => entry.value.trim().toLowerCase() === perm.name.trim().toLowerCase())) {
          return current;
        }
        return [...nextNames, { __id: genId(), value: perm.name }];
      });
    } else {
      setVName(perm.name);
    }
    if (perm.phone) setVPhone(perm.phone);
    setShowPermsPicker(false);
  };

  const handleSubmit = async () => {
    // D-01: sync guard prevents double-submit
    if (submittingRef.current) return;

    const sanitized = sanitizeRequestFormFields({
      visitorName: vName,
      visitorNames: vNames.map((n) => n.value),
      visitorPhone: vPhone,
      carPlate,
      comment,
    });

    // Validation
    if (type === 'pass' && cat === 'taxi'  && !sanitized.carPlate)                  { toast('Укажите марку и номер авто', 'error');  return; }
    if (type === 'pass' && ['guest', 'team'].includes(cat) && sanitized.visitorNames.length === 0) { toast('Укажите имена посетителей', 'error'); return; }
    if (type === 'pass' && cat !== 'guest' && requiresVisitorName(cat) && !sanitized.visitorName) { toast('Укажите имя посетителя', 'error'); return; }

    submittingRef.current = true;
    setLoading(true);

    const schedDate      = showSchedule && scheduledFor ? new Date(scheduledFor) : null;
    const isScheduled    = Boolean(schedDate && schedDate > new Date());
    const parsedValidUntil = type === 'pass' && validUntil ? parseLocalDateInputValue(validUntil) : null;
    if (type === 'pass' && validUntil && !parsedValidUntil) {
      // Reset submission guard — this is a validation error, not a real submit
      submittingRef.current = false;
      if (isMountedRef.current) setLoading(false);
      toast('Некорректная дата действия пропуска', 'error');
      return;
    }

    const status: RequestStatus = isScheduled ? 'scheduled' : 'pending';
    const newReq: AppRequest = {
      id:            genId('r'),
      type,
      category:      cat,
      createdByUid:  user.uid,
      createdByRole: user.role,
      createdByName: user.name,
      createdByApt:  user.apartment,
      visitorName:   type !== 'pass'       ? null
                   : cat  === 'taxi'       ? null
                   : ['guest', 'team'].includes(cat) ? sanitized.visitorNames.join(', ') || null
                   : sanitized.visitorName || null,
      carPlate:      needsCarPlate(cat)    ? sanitized.carPlate || null : null,
      visitorPhone:  type === 'pass'       ? sanitized.visitorPhone || null : null,
      comment:       sanitized.comment,
      priority:      'normal',
      passDuration:  type === 'pass' ? (validUntil ? 'temporary' : 'once') : null,
      validUntil:    parsedValidUntil,
      photo:         null,
      photos:        [],
      status,
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

      let savedRequest: AppRequest = { ...newReq, _pending: false };
      if (mode && typeof mode === 'object' && 'id' in mode) {
        deleteRequest(tempId);
        addRequest(mode as AppRequest);
        savedRequest = mode as AppRequest;
      } else {
        updateRequest(tempId, { _pending: false });
      }

      const successMsg = isScheduled
        ? 'Запланировано на ' + fmtScheduled(scheduledFor)
        : type === 'pass' ? 'Пропуск создан' : 'Заявка отправлена';
      toastBySyncResult(
        typeof mode === 'string' ? mode : 'synced',
        successMsg,
        'Заявка сохранена локально. Синхронизация будет повторена позже',
      );
      onDone(savedRequest);
      onClose();
    } catch(e) {
      // FIX [UX-2]: rollback optimistic update on server error
      deleteRequest(newReq.id);
      if (isMountedRef.current) {
        // P-05: offer retry action so users can resubmit without re-filling the form
        toast(
          presentError(e, 'request.submit').message,
          'error',
          {
            label: 'Повторить',
            onClick: handleSubmit,
            secondaryLabel: 'Открыть офлайн-очередь',
            onSecondaryClick: () => { window.location.assign('/dashboard/passes?offlineQueue=1'); },
          },
        );
      }
    } finally {
      // FIX [ВАЖНО-CQ2]: always reset in finally — prevents stuck loading state on any exit path
      submittingRef.current = false;
      if (isMountedRef.current) setLoading(false);
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


// Backward-compatible re-export contract for tests/legacy imports
export { toLocalDateInputValue, toLocalDateTimeInputValue, parseLocalDateInputValue };
