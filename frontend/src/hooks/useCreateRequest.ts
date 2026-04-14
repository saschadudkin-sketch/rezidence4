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
import { sanitizeText } from '../utils/inputSanitizer';
import { getRequestInitialStatus } from '../domain/passLifecycle';
import { useRequestFormState } from './useRequestFormState';
import type { AppRequest, RequestStatus, RequestType, PassDuration } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { PermEntry } from '../store/slices/permsSlice';
import type { ServiceMutationResult } from '../services/providers/ServiceContracts';

type VisitorNameEntry = { __id: string; value: string };
type CreateRequestSeed = Record<string, unknown> | undefined;

type UseCreateRequestArgs = {
  user: AppUser;
  type: RequestType;
  initialCat?: string;
  initialData?: CreateRequestSeed;
  onClose: () => void;
  onDone: (request?: AppRequest) => void;
  onSubmitted?: () => void;
};

export const needsCarPlate = (cat: string): boolean =>
  ['guest', 'taxi', 'car', 'master', 'delivery'].includes(cat);

export const requiresVisitorName = (cat: string): boolean =>
  !['taxi', 'car', 'master', 'team'].includes(cat);

export const hasVisitorFields = (cat: string): boolean =>
  cat !== 'taxi' && cat !== 'team';

export const canUsePermsList = (type: RequestType, cat: string): boolean =>
  type === 'pass' && !['taxi', 'team', 'courier'].includes(cat);

export function useCreateRequest({ user, type, initialCat, initialData, onClose, onDone, onSubmitted }: UseCreateRequestArgs) {
  const {
    cats, cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    apartment, setApartment,
    comment, setComment,
    validUntil, setValidUntil,
  } = useRequestFormState({ type, user, initialCat, initialData });

  const [loading, setLoading] = useState(false);
  const [showPermsPicker, setShowPermsPicker] = useState(false);

  const { addTemplate, addRequest, deleteRequest, updateRequest } = useActions();
  const userPerms = usePerms(user.uid);
  const permsList: PermEntry[] = canUsePermsList(type, cat)
    ? [...(user.role === 'contractor' ? userPerms.workers : userPerms.visitors)]
    : [];

  const isMountedRef = useIsMounted();
  const submittingRef = useRef(false);

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, []);

  const { photos, handlePhoto, removePhoto } = usePhotoHandler(isMountedRef);
  const { showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset } = useScheduleForm();
  const { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl } = useTemplateForm({
    type,
    cat,
    vName,
    vNames,
    vPhone,
    carPlate,
    comment,
    uid: user.uid,
    addTemplate,
  });

  const handlePickPerm = (perm: PermEntry) => {
    if (cat === 'guest') {
      setVNames((current: VisitorNameEntry[]) => {
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
    if (submittingRef.current) return;

    const sanitized = sanitizeRequestFormFields({
      visitorName: vName,
      visitorNames: vNames.map((entry: VisitorNameEntry) => entry.value),
      visitorPhone: vPhone,
      carPlate,
      comment,
    });

    const targetApartment = type === 'pass' && user.role === 'concierge'
      ? sanitizeText(apartment)
      : user.apartment;

    if (type === 'pass' && user.role === 'concierge' && !targetApartment) {
      toast('Укажите апартамент, для которого оформляется пропуск', 'error');
      return;
    }
    if (type === 'pass' && ['taxi', 'car'].includes(cat) && !sanitized.carPlate) {
      toast('Укажите марку и номер авто', 'error');
      return;
    }
    if (type === 'pass' && ['guest', 'team'].includes(cat) && sanitized.visitorNames.length === 0) {
      toast('Укажите имена посетителей', 'error');
      return;
    }
    if (type === 'pass' && cat !== 'guest' && requiresVisitorName(cat) && !sanitized.visitorName) {
      toast('Укажите имя посетителя', 'error');
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    const schedDate = showSchedule && scheduledFor ? new Date(scheduledFor) : null;
    const isScheduled = Boolean(schedDate && schedDate > new Date());
    const parsedValidUntil = type === 'pass' && validUntil ? parseLocalDateInputValue(validUntil) : null;
    if (type === 'pass' && validUntil && !parsedValidUntil) {
      submittingRef.current = false;
      if (isMountedRef.current) setLoading(false);
      toast('Некорректная дата действия пропуска', 'error');
      return;
    }

    const passDuration: PassDuration | undefined = type === 'pass'
      ? (validUntil ? 'temporary' : 'once')
      : undefined;

    const status: RequestStatus = getRequestInitialStatus({
      type,
      userRole: user.role,
      passDuration,
      isScheduled,
    });

    const newReq: AppRequest = {
      id: genId('r'),
      type,
      category: cat,
      createdByUid: user.uid,
      createdByRole: user.role,
      createdByName: user.name,
      ...(targetApartment ? { createdByApt: targetApartment } : {}),
      ...(type === 'pass'
        ? {
            visitorName:
              cat === 'taxi'
                ? undefined
                : ['guest', 'team'].includes(cat)
                  ? sanitized.visitorNames.join(', ') || undefined
                  : sanitized.visitorName || undefined,
            carPlate: needsCarPlate(cat) ? sanitized.carPlate || undefined : undefined,
            visitorPhone: sanitized.visitorPhone || null,
          }
        : {}),
      ...(sanitized.comment ? { comment: sanitized.comment } : {}),
      priority: 'normal',
      ...(passDuration ? { passDuration } : {}),
      ...(parsedValidUntil ? { validUntil: parsedValidUntil } : {}),
      photo: null,
      photos: [],
      status,
      createdAt: new Date(),
      arrivedAt: null,
      scheduledFor: schedDate,
    };

    try {
      const tempId = newReq.id;

      if (photos.length > 0) {
        newReq.photos = await services.requests.resolvePhotos(tempId, photos);
        newReq.photo = newReq.photos[0] || null;
      }

      if (!isMountedRef.current) return;

      addRequest({ ...newReq, _pending: true });

      const mode = await services.requests.submit({ request: newReq, addLocal: () => {} }) as ServiceMutationResult | AppRequest;

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
        : status === 'approved'
          ? 'Пропуск создан и активен'
          : type === 'pass'
            ? 'Пропуск создан'
            : 'Заявка отправлена';

      toastBySyncResult(
        typeof mode === 'string' ? mode : 'synced',
        successMsg,
        'Заявка сохранена локально. Синхронизация будет повторена позже',
      );
      onSubmitted?.();
      onDone(savedRequest);
      onClose();
    } catch (error) {
      deleteRequest(newReq.id);
      if (isMountedRef.current) {
        toast(
          presentError(error, 'request.submit').message,
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
      submittingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  };

  return {
    cats, cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    apartment, setApartment,
    comment, setComment,
    validUntil, setValidUntil,
    photos, removePhoto,
    loading,
    permsList,
    showSaveTpl, setShowSaveTpl,
    tplName, setTplName,
    showSchedule, setShowSchedule,
    scheduledFor, setScheduledFor,
    showPermsPicker, setShowPermsPicker,
    handlePhoto,
    applyPreset,
    handleSaveTpl,
    handlePickPerm,
    handleSubmit,
  };
}

export { toLocalDateInputValue, toLocalDateTimeInputValue, parseLocalDateInputValue };
