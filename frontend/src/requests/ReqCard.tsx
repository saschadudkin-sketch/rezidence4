import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import type { CSSProperties } from 'react';
import { useIsMounted } from '../hooks/useIsMounted';
import { toast } from '../ui/Toasts';
import { PassQRModal } from './PassQRModal';
import {
  useActions, useAvatar,
  useRequestHistory as useReqHistory,
} from '../store/AppStore';
import { CAT_LABEL, STS_LABEL, ROLE_LABELS, PASS_DURATION_LABEL, PASS_DURATION_ICON } from '../constants/index';
import {
  canApproveRequest as canApproveByRole,
  canRejectRequest as canRejectByRole,
  canAcceptRequest as canAcceptByRole,
  canMarkArrival as canMarkArrivalByRole,
} from '../domain/permissions';
import {
  isActiveRequest, isPendingRequest,
  isApprovedRequest, isScheduledRequest,
  canManageRequests, canApproveRequests, shouldShowActions,
} from '../constants/requestPredicates';
import { fmtDate, fmtTime } from '../utils';
import { AvatarCircle } from '../ui/AvatarCircle';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import { AppIcon } from '../ui/AppIcon';
import type { AppRequest, HistoryEntry } from '../store/slices/requestsSlice';
import type { UserRole } from '../store/slices/usersSlice';

type ReqPhotoProps = { src: string };
export type ReqCardProps = {
  req: AppRequest;
  userRole: UserRole | string;
  userName: string;
  userId: string;
  staggerIdx?: number;
  onRepeat?: (req: AppRequest) => void;
  onEdit?: (req: AppRequest) => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
  highlightId?: string | null;
  onHighlighted?: () => void;
};

type ReqActionToastType = 'success' | 'error';
type ReqActionFn = () => Promise<void>;

const getRoleLabel = (role?: string) => (
  role && role in ROLE_LABELS
    ? ROLE_LABELS[role as keyof typeof ROLE_LABELS]
    : role ?? ''
);

const getCategoryLabel = (category?: string) => (
  category && category in CAT_LABEL
    ? CAT_LABEL[category as keyof typeof CAT_LABEL]
    : category ?? ''
);

const getPassDurationMeta = (passDuration?: AppRequest['passDuration']) => {
  if (!passDuration) return null;
  return {
    icon: PASS_DURATION_ICON[passDuration] ?? 'ticket',
    label: PASS_DURATION_LABEL[passDuration],
  };
};

const asUserRole = (role?: string): UserRole | null => (
  role && role in ROLE_LABELS ? role as UserRole : null
);

const ReqPhoto = memo(function ReqPhoto({ src }: ReqPhotoProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={src} alt="фото" className="req-photo-img" loading="lazy" decoding="async" onClick={() => setOpen(true)} />
      {open && <PhotoLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
});

const ReqPhotos = memo(function ReqPhotos({ req }: { req: AppRequest }) {
  const photos = req.photos && req.photos.length > 0 ? req.photos : req.photo ? [req.photo] : [];
  if (photos.length === 0) return null;
  return (
    <div className="req-photos-grid">
      {photos.map((src, i) => <ReqPhoto key={i} src={src} />)}
    </div>
  );
});

export function ReqSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="req-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={'skeleton-card skeleton-card--delay-' + i}>
          <div className="skeleton-row">
            <div className="skeleton-avatar" />
            <div className="skeleton-lines">
              <div className="skeleton-bar wide" />
              <div className="skeleton-bar mid" />
            </div>
            <div className="u-col-end-g6">
              <div className="skeleton-bar skeleton-bar--w48" />
              <div className="skeleton-bar skeleton-bar--w64" />
            </div>
          </div>
          <div className="skeleton-bar skeleton-bar--w80 u-mt-2" />
        </div>
      ))}
    </div>
  );
}

const ReqCardDetails = memo(function ReqCardDetails({ req, history }: { req: AppRequest; history: HistoryEntry[] }) {
  const passDurationMeta = getPassDurationMeta(req.passDuration);
  if (!(req.arrivedAt || req.visitorName || req.carPlate || req.visitorPhone || req.comment)) return null;
  return (
    <div className="req-details">
      {req.arrivedAt && <div><div className="det-lbl">Вход отмечен</div><div className="det-val u-arrived">{new Date(req.arrivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div></div>}
      {req.scheduledFor && isScheduledRequest(req) && <div className="u-grid-span"><div className="det-lbl">Отправка запланирована</div><div className="det-val u-scheduled-t">{new Date(req.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div></div>}
      {passDurationMeta && <div><div className="det-lbl">Тип пропуска</div><div className="det-val"><AppIcon name={passDurationMeta.icon} className="u-inline-icon" /> {passDurationMeta.label}</div></div>}
      {req.validUntil && <div><div className="det-lbl">Действует до</div><div className="det-val">{new Date(req.validUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>}
      {req.carPlate && <div><div className="det-lbl">Авто</div><div className="det-val">{req.carPlate}</div></div>}
      {req.visitorName && <div><div className="det-lbl">Посетитель</div><div className="det-val">{req.visitorName}</div></div>}
      {req.visitorPhone && <div><div className="det-lbl">Телефон</div><div className="det-val">{req.visitorPhone}</div></div>}
      {req.comment && <div className="u-grid-span"><div className="det-lbl">Комментарий</div><div className="det-val">{req.comment}</div></div>}
      {history.length > 0 && (
        <div className="u-grid-span">
          <div className="det-lbl">История</div>
          {history.map((entry, index) => (
            <div key={`${entry.at || index}-${index}`} className="req-history-row">
              <span className="req-history-time">{fmtTime(entry.at)}</span> · {entry.action} · <span className="u-t4">{getRoleLabel(entry.byRole)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const ReqCardStaffActions = memo(function ReqCardStaffActions({
  req, actLoading, mayApprove, mayReject, mayAccept, mayMarkArrival,
  doApprove, doReject, doAccept, doArrive,
}: {
  req: AppRequest;
  actLoading: string | null;
  mayApprove: boolean;
  mayReject: boolean;
  mayAccept: boolean;
  mayMarkArrival: boolean;
  doApprove: () => Promise<void>;
  doReject: () => Promise<void>;
  doAccept: () => Promise<void>;
  doArrive: () => Promise<void>;
}) {
  const [confirmReject, setConfirmReject] = useState(false);
  return (
    <div className="req-actions" aria-busy={!!actLoading}>
      {req.type === 'pass' ? (
        <>
          {mayApprove && <button className="btn-yes" onClick={doApprove} disabled={!!actLoading}>{actLoading === 'approve' && <span className="btn-spin" />}Разрешить</button>}
          {mayReject && !confirmReject && (
            <button className="btn-no" onClick={() => setConfirmReject(true)} disabled={!!actLoading}>
              {actLoading === 'reject' && <span className="btn-spin" />}Отказать
            </button>
          )}
          {mayReject && confirmReject && (
            <span className="req-confirm-reject">
              <span className="req-confirm-label">Отказать?</span>
              <button className="btn-no" onClick={() => { setConfirmReject(false); void doReject(); }} disabled={!!actLoading}>Да</button>
              <button className="btn-outline" onClick={() => setConfirmReject(false)}>Нет</button>
            </span>
          )}
          {mayMarkArrival && isApprovedRequest(req) && <button className="btn-arrive" onClick={doArrive} disabled={!!actLoading}>{actLoading === 'arrive' && <span className="btn-spin" />}Отметить вход</button>}
          {req.status === 'rejected' && <button className="btn-yes" onClick={doApprove} disabled={!!actLoading}>{actLoading === 'approve' && <span className="btn-spin" />}Разрешить</button>}
        </>
      ) : (
        <>
          {mayAccept && req.status !== 'accepted' && <button className="btn-accept" onClick={doAccept} disabled={!!actLoading}>{actLoading === 'accept' && <span className="btn-spin" />}Принять заявку</button>}
        </>
      )}
    </div>
  );
});

const ReqCardResidentActions = memo(function ReqCardResidentActions({
  req, onRepeat, onEdit, onDelete, onCancel, isStaffRole, actLoading,
}: {
  req: AppRequest;
  onRepeat?: (req: AppRequest) => void;
  onEdit?: (req: AppRequest) => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
  isStaffRole: boolean;
  actLoading: string | null;
}) {
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <>
      {onRepeat && req.status !== 'pending' && (
        <button className="tpl-save-btn" onClick={() => onRepeat(req)} disabled={actLoading === 'repeat'}>
          {actLoading === 'repeat' && <span className="btn-spin" />}
          <span className="u-inline-icon u-mr6"><AppIcon name="undo" size={12} /></span>
          Повторить заявку
        </button>
      )}
      {(onEdit || onDelete) && isPendingRequest(req) && (
        <div className="u-flex u-flex-end u-gap-6 u-mt-8">
          {confirmDel ? (
            <>
              <span className="u-fs-2xs u-t3">Удалить?</span>
              <button className="btn-del-sm" onClick={() => onDelete?.(req.id)} disabled={actLoading === 'delete'}>
                {actLoading === 'delete' && <span className="btn-spin" />}Да
              </button>
              <button className="btn-outline btn-outline--sm" onClick={() => setConfirmDel(false)}>Нет</button>
            </>
          ) : (
            <>
              {onEdit && (
                <button className="btn-edit" onClick={() => onEdit(req)}>
                  <span className="u-inline-icon u-mr6"><AppIcon name="edit" size={12} /></span>
                  Редактировать
                </button>
              )}
              {onDelete && (
                <button className="btn-del-sm" onClick={() => setConfirmDel(true)}>
                  <span className="u-inline-icon u-mr6"><AppIcon name="trash" size={12} /></span>
                  Удалить
                </button>
              )}
            </>
          )}
        </div>
      )}
      {onCancel && (req.status === 'pending' || req.status === 'approved') && !isStaffRole && (
        <div className="u-flex u-flex-end u-mt-8">
          <button className="btn-outline btn-cancel-req" onClick={() => onCancel(req.id)} disabled={actLoading === 'cancel'}>
            {actLoading === 'cancel' && <span className="btn-spin" />}
            <span className="u-inline-icon u-mr6"><AppIcon name="close" size={12} /></span>
            Отменить заявку
          </button>
        </div>
      )}
    </>
  );
});

export const ReqCard = memo(function ReqCard({ req, userRole, userName, userId, staggerIdx = 0, onRepeat, onEdit, onDelete, onCancel, highlightId, onHighlighted }: ReqCardProps) {
  const isStaffRole = canManageRequests(userRole);
  const isActive = isActiveRequest(req);
  const isQrAvailable = req.type === 'pass' && req.status === 'approved';
  const [actLoading, setActLoading] = useState<string | null>(null);
  const isHighlighted = highlightId === req.id;
  const isCancellable = Boolean(onCancel && (req.status === 'pending' || req.status === 'approved'));
  const [expanded, setExpanded] = useState((isStaffRole && isActive) || isHighlighted || isCancellable);
  const [showQR, setShowQR] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const history = useReqHistory(req.id);
  const { approveRequest, rejectRequest, acceptRequest, arriveRequest } = useActions();
  const avData = useAvatar(req.createdByUid ?? '');
  const passDurationMeta = getPassDurationMeta(req.passDuration);

  const { mayApprove, mayReject, mayAccept, mayMarkArrival } = useMemo(() => {
    const actor = { role: userRole, uid: userId };
    return {
      mayApprove: canApproveByRole(actor, req),
      mayReject: canRejectByRole(actor, req),
      mayAccept: canAcceptByRole(actor, req),
      mayMarkArrival: canMarkArrivalByRole(actor, req),
    };
  }, [req, userRole, userId]);

  const dateLabel = useMemo(() => {
    const formattedDate = fmtDate(req.createdAt);
    return (formattedDate === 'сегодня' || formattedDate === 'только что')
      ? `${formattedDate} ${fmtTime(req.createdAt)}`
      : formattedDate;
  }, [req.createdAt]);

  useEffect(() => {
    if (!isHighlighted || !cardRef.current) return;

    setExpanded(true);

    const t1 = setTimeout(() => {
      if (!cardRef.current) return;
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardRef.current.classList.add('req-card-highlight');
    }, 100);

    const t2 = setTimeout(() => {
      cardRef.current?.classList.remove('req-card-highlight');
      onHighlighted?.();
    }, 2100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isHighlighted, onHighlighted]);

  const actorName = userName || userRole;
  const actLoadingRef = useRef<string | null>(actLoading);
  actLoadingRef.current = actLoading;
  const isMountedRef = useIsMounted();

  const act = useCallback(async (key: string, fn: ReqActionFn, msg: string, type: ReqActionToastType) => {
    if (actLoadingRef.current) return;
    if (!isMountedRef.current) return;
    setActLoading(key);
    try {
      await fn();
      if (isMountedRef.current) toast(msg, type);
    } catch {
      if (isMountedRef.current) toast('Ошибка операции', 'error');
    } finally {
      if (isMountedRef.current) setActLoading(null);
    }
  }, []);

  const doApprove = useCallback(() => act('approve', () => Promise.resolve(approveRequest(req.id, actorName, userRole)), 'Допуск предоставлен', 'success'), [act, approveRequest, req.id, actorName, userRole]);
  const doReject = useCallback(() => act('reject', () => Promise.resolve(rejectRequest(req.id, actorName, userRole)), 'В допуске отказано', 'error'), [act, rejectRequest, req.id, actorName, userRole]);
  const doAccept = useCallback(() => act('accept', () => Promise.resolve(acceptRequest(req.id, actorName, userRole)), 'Заявка принята в работу', 'success'), [act, acceptRequest, req.id, actorName, userRole]);
  const doArrive = useCallback(() => act('arrive', () => Promise.resolve(arriveRequest(req.id, actorName, userRole)), 'Отмечен вход на территорию', 'success'), [act, arriveRequest, req.id, actorName, userRole]);

  const hasDetails = Boolean(req.arrivedAt || req.visitorName || req.carPlate || req.visitorPhone || req.comment || req.photo || req.photos?.length || history.length);
  const showActions = shouldShowActions(req, {
    userRole,
    onRepeat: onRepeat ? () => onRepeat(req) : undefined,
    onEdit: onEdit ? () => onEdit(req) : undefined,
    onDelete: onDelete ? () => onDelete(req.id) : undefined,
    onCancel: onCancel ? () => onCancel(req.id) : undefined,
  });
  const cardStyle = { '--card-delay': (staggerIdx * 45) + 'ms' } as CSSProperties;
  const categoryLabel = getCategoryLabel(req.category);
  const createdByName = req.createdByName ?? '';

  return (
    <div ref={cardRef} className={'req-card ' + req.status} style={cardStyle} role="article" aria-label={(req.visitorName || categoryLabel) + ' — ' + createdByName}>
      <div className={'req-head' + ((hasDetails || showActions) ? ' req-head--clickable' : '')}
        onClick={() => (hasDetails || showActions) && setExpanded((open) => !open)}>
        <div className="req-left">
          <div className="req-ico">
            <AvatarCircle avData={avData} role={asUserRole(req.createdByRole)} name={createdByName || '?'} size={34} fontSize={13} />
          </div>
          <div className="u-mw0">
            <div className="req-cat">
              {req.createdByApt && req.createdByApt !== '—' ? 'Апарт. ' + req.createdByApt + ' · ' : ''}
              {createdByName}
            </div>
            <div className="req-meta">
              <span className="u-inline-icon u-mr6 req-type-icon">
                <AppIcon name={req.type === 'tech' ? 'tools' : 'ticket'} size={12} />
              </span>
              {categoryLabel}
              {passDurationMeta && req.passDuration !== 'once' && (
                <span className={'pass-dur-tag ' + req.passDuration}><AppIcon name={passDurationMeta.icon} className="u-inline-icon" /> {passDurationMeta.label}</span>
              )}
            </div>
          </div>
        </div>
        <div className="u-col-end-g4">
          <span className="req-date-label">{dateLabel}</span>
          <span className={'badge ' + req.status}>{STS_LABEL[req.status]}</span>
        </div>
      </div>

      {expanded && (
        <>
          <ReqCardDetails req={req} history={history} />
          <ReqPhotos req={req} />

          {req.type === 'pass' && (req.status === 'approved' || req.status === 'pending') && (
            <button className="qr-pass-btn" type="button" onClick={isQrAvailable ? () => setShowQR(true) : undefined} disabled={!isQrAvailable}>
              <span className="u-inline-icon"><AppIcon name="qr" size={18} /></span>
              <div>
                <div className="qr-pass-label">QR-код пропуска</div>
                <div className="qr-pass-hint">
                  {req.status === 'approved'
                    ? 'Откройте QR-код и покажите его охраннику на КПП для прохода'
                    : 'QR-код станет активным после одобрения заявки охраной'}
                </div>
              </div>
            </button>
          )}

          {canApproveRequests(userRole) && (
            <ReqCardStaffActions
              req={req}
              actLoading={actLoading}
              mayApprove={mayApprove}
              mayReject={mayReject}
              mayAccept={mayAccept}
              mayMarkArrival={mayMarkArrival}
              doApprove={doApprove}
              doReject={doReject}
              doAccept={doAccept}
              doArrive={doArrive}
            />
          )}

          <ReqCardResidentActions
            req={req}
            onRepeat={onRepeat}
            onEdit={onEdit}
            onDelete={onDelete}
            onCancel={onCancel}
            isStaffRole={isStaffRole}
            actLoading={actLoading}
          />
        </>
      )}
      {showQR && isQrAvailable && <PassQRModal req={req} onClose={() => setShowQR(false)} />}
    </div>
  );
});

export { GroupedReqList } from './GroupedReqList';
