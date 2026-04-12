import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createRequestsOptimisticController } from '../services/consistency/requestsOptimistic';
import { useActions, useRequests } from '../store/AppStore';
import { CreateModal } from '../requests/CreateModal';
import { EditRequestModal } from '../requests/EditRequestModal';
import { PermsList } from '../perms/PermsList';
import { ChatView } from '../chat/ChatView';
import { toast } from '../ui/Toasts';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AppIcon } from '../ui/AppIcon';
import { can, ROLES } from '../domain/permissions';
import { CAT_LABEL, STS_LABEL } from '../constants/index';
import GarageView from './GarageView';
import { isLiveMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
import { presentError } from '../ui/errorPresenter';
import PassesTab from './resident/PassesTab';
import TechTab from './resident/TechTab';
import TemplatesTab from './resident/TemplatesTab';
import HistoryTab from './resident/HistoryTab';
import { useUrlSearchParams } from '../hooks/useUrlSearchParams';
import type { AppRequest, RequestStatus, RequestType } from '../store/slices/requestsSlice';

const INACTIVE_STATUSES = new Set(['cancelled', 'rejected', 'expired']);
const COMPLETED_STATUSES = new Set(['arrived', 'rejected', 'expired', 'cancelled']);

type ResidentModalState = {
  type: RequestType;
  cat: string;
  data?: {
    visitorName?: unknown;
    visitorPhone?: unknown;
    carPlate?: unknown;
    comment?: unknown;
  };
};

function getPassReadyText(request) {
  const guest = request.visitorName || CAT_LABEL[request.category] || 'Гость';
  const apartment = request.createdByApt ? `Апартаменты ${request.createdByApt}` : 'Резиденции Замоскворечья';
  const car = request.carPlate ? `\nАвто: ${request.carPlate}` : '';
  const schedule = request.scheduledFor
    ? `\nВремя: ${new Date(request.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
    : '';
  return `Пропуск для: ${guest}\n${apartment}${schedule}${car}\nСтатус: ${STS_LABEL[request.status] || 'создан'}`;
}

function PassReadySheet({ request, onClose, onCreateAnother }) {
  if (!request) return null;
  const title = request.scheduledFor ? 'Пропуск запланирован' : 'Пропуск готов';
  const guest = request.visitorName || CAT_LABEL[request.category] || 'Гость';
  const validText = request.scheduledFor
    ? new Date(request.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Охрана увидит его сразу';
  const shareText = getPassReadyText(request);

  const copyPass = async () => {
    try {
      await navigator.clipboard?.writeText(shareText);
      toast('Данные пропуска скопированы', 'success');
    } catch {
      toast('Не удалось скопировать. Проверьте разрешения браузера', 'error');
    }
  };

  const sharePass = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: shareText });
        return;
      } catch {
        return;
      }
    }
    await copyPass();
  };

  return (
    <div className="overlay resident-ready-overlay">
      <div className="resident-ready-sheet" role="dialog" aria-modal="true" aria-labelledby="resident-ready-title">
        <button className="resident-ready-close" onClick={onClose} aria-label="Закрыть">
          <AppIcon name="close" size={14} />
        </button>
        <div className="resident-ready-mark">
          <AppIcon name="check" size={24} />
        </div>
        <div className="resident-ready-kicker">Готово</div>
        <h2 id="resident-ready-title" className="resident-ready-title">{title}</h2>
        <p className="resident-ready-sub">
          {guest}. {validText}. Статус можно проверить в активных пропусках.
        </p>
        <div className="resident-ready-summary">
          <div>
            <span>Кому</span>
            <strong>{guest}</strong>
          </div>
          {request.carPlate && (
            <div>
              <span>Авто</span>
              <strong>{request.carPlate}</strong>
            </div>
          )}
          <div>
            <span>Статус</span>
            <strong>{STS_LABEL[request.status] || 'Создан'}</strong>
          </div>
        </div>
        <div className="resident-ready-actions">
          <button className="btn-gold" onClick={sharePass}>
            <span className="u-inline-icon"><AppIcon name="copy" size={14} /> Отправить гостю</span>
          </button>
          <button className="btn-outline" onClick={copyPass}>Скопировать</button>
          <button className="btn-text" onClick={onCreateAnother}>Создать ещё один</button>
        </div>
      </div>
    </div>
  );
}

export default function ResidentView({ user, activeTab, setActiveTab }) {
  const requests = useRequests();
  const { deleteRequest, updateRequest, addRequest } = useActions();
  const requestsRef = useRef(requests);
  const optimisticRef = useRef(createRequestsOptimisticController());
  const [modal,         setModal]         = useState<ResidentModalState | null>(null);
  const [editReq,       setEditReq]       = useState<AppRequest | null>(null);
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const passFilter = searchParams.get('passFilter') || 'active';
  const techFilter = searchParams.get('techFilter') || 'active';
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [readyPass, setReadyPass] = useState<AppRequest | null>(null);

  const setPassFilter = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'active') next.delete('passFilter');
    else next.set('passFilter', value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setTechFilter = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'active') next.delete('techFilter');
    else next.set('techFilter', value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);


  const openModal = useCallback((next: ResidentModalState) => {
    toast.clearAll?.();
    setModal(next);
  }, []);

  const onEdit = useCallback(r => { if (can(user).editRequest(r)) setEditReq(r); }, [user]);

  const onRepeatPass = useCallback(r => openModal({
    type: r.type, cat: r.category,
    data: { visitorName: r.visitorName, visitorPhone: r.visitorPhone, carPlate: r.carPlate, comment: r.comment },
  }), [openModal]);
  const onRepeatTech = useCallback(r => openModal({
    type: r.type, cat: r.category, data: { comment: r.comment },
  }), [openModal]);

  // T-6+: optimistic operation-log (not snapshot-only rollback)
  const onDeleteConfirmed = useCallback(async id => {
    setConfirmDelete(null);
    const originalReq = requestsRef.current.find(r => r.id === id);
    if (!originalReq) return;
    const opId = optimisticRef.current.begin('delete', originalReq);
    // Soft optimistic marker for conflict-safe rollback decision
    updateRequest(id, { _optimisticOpId: opId });
    deleteRequest(id);
    try {
      if (isLiveMode()) {
        await services.requests.deleteEverywhere({ requestId: id });
      }
      optimisticRef.current.end(opId);
      toast('Заявка удалена', 'success');
    } catch (e) {
      const current = requestsRef.current.find(r => r.id === id);
      if (optimisticRef.current.shouldRollback(opId, current)) {
        addRequest({ ...originalReq, _optimisticOpId: undefined });
      }
      optimisticRef.current.end(opId);
      toast(presentError(e, 'default').message, 'error');
    }
  }, [deleteRequest, updateRequest, addRequest]);

  const onDelete = useCallback((id) => setConfirmDelete(id), []);

  const onCancelConfirmed = useCallback(async id => {
    setConfirmCancel(null);
    const originalReq = requestsRef.current.find(r => r.id === id);
    if (!originalReq) return;
    const opId = optimisticRef.current.begin('cancel', originalReq);
    const patch: { status: RequestStatus } = { status: 'cancelled' };
    updateRequest(id, { ...patch, _optimisticOpId: opId });
    try {
      if (isLiveMode()) {
        await services.requests.updateEverywhere({ requestId: id, patch, historyLabel: 'Отменено жильцом' });
      }
      updateRequest(id, { _optimisticOpId: undefined });
      optimisticRef.current.end(opId);
      toast('Заявка отменена', 'success');
    } catch (e) {
      const current = requestsRef.current.find(r => r.id === id);
      if (optimisticRef.current.shouldRollback(opId, current)) {
        updateRequest(id, { status: originalReq.status, _optimisticOpId: undefined });
      }
      optimisticRef.current.end(opId);
      toast(presentError(e, 'default').message, 'error');
    }
  }, [updateRequest]);

  const onCancel = useCallback((id) => setConfirmCancel(id), []);

  // PERF-2: Single useMemo replaces 7 separate memos — one pass over requests array
  const computed = useMemo(() => {
    const myPasses = requests.filter(r => r.createdByUid === user.uid && r.type === 'pass');
    const myTech   = requests.filter(r => r.createdByUid === user.uid && r.type === 'tech');

    const scheduledPasses = myPasses.filter(r => r.status === 'scheduled');
    const basePasses      = myPasses.filter(r => r.status !== 'scheduled');

    let filteredPasses;
    if (passFilter === 'all')       filteredPasses = basePasses;
    else if (passFilter === 'active')    filteredPasses = basePasses.filter(r => !INACTIVE_STATUSES.has(r.status));
    else if (passFilter === 'scheduled') filteredPasses = scheduledPasses;
    else                                 filteredPasses = basePasses.filter(r => (r.passDuration || 'once') === passFilter);

    const filteredTech = techFilter === 'all'
      ? myTech
      : myTech.filter(r => !INACTIVE_STATUSES.has(r.status));

    const tempCount = myPasses.filter(r => r.passDuration === 'temporary').length;
    const permCount = myPasses.filter(r => r.passDuration === 'permanent').length;

    const completedRequests = requests
      .filter(r => r.createdByUid === user.uid && COMPLETED_STATUSES.has(r.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { myPasses, myTech, scheduledPasses, filteredPasses, filteredTech, tempCount, permCount, completedRequests };
  }, [requests, user.uid, passFilter, techFilter]);

  return (
    <>
      {activeTab === 'passes' && (
        <PassesTab
          user={user}
          passFilter={passFilter} setPassFilter={setPassFilter}
          setModal={openModal}
          onRepeatPass={onRepeatPass} onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
          computed={computed}
        />
      )}

      {activeTab === 'tech' && (
        <TechTab
          user={user}
          techFilter={techFilter} setTechFilter={setTechFilter}
          setModal={openModal}
          onRepeatTech={onRepeatTech} onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
          computed={computed}
        />
      )}

      {activeTab === 'perms' && (
        <div>
          <PermsList user={user} />
          {user.role !== ROLES.CONTRACTOR && <GarageView user={user} targetUid={user.uid} />}
        </div>
      )}

      {activeTab === 'templates' && (
        <TemplatesTab user={user} setModal={openModal} />
      )}

      {activeTab === 'history' && (
        <HistoryTab user={user} onRepeatPass={onRepeatPass} onRepeatTech={onRepeatTech} computed={computed} />
      )}

      {activeTab === 'chat' && <ChatView user={user} />}

      {modal   && (
        <CreateModal
          key={modal.cat + '_' + modal.type}
          user={user}
          type={modal.type}
          initialCat={modal.cat}
          initialData={modal.data}
          onClose={() => setModal(null)}
          onDone={(request) => {
            setActiveTab(modal.type === 'tech' ? 'tech' : 'passes');
            setModal(null);
            if (modal.type === 'pass' && request) setReadyPass(request);
          }}
        />
      )}
      {editReq && <EditRequestModal req={editReq} onClose={() => setEditReq(null)} onDone={() => {}} />}
      <PassReadySheet
        request={readyPass}
        onClose={() => setReadyPass(null)}
        onCreateAnother={() => {
          setReadyPass(null);
          openModal({ type: 'pass', cat: 'guest' });
        }}
      />

      {/* A-06: replace IIFE pattern with computed variables before JSX */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Удалить заявку для «${
            requests.find(r => r.id === confirmDelete)?.visitorName ||
            requests.find(r => r.id === confirmDelete)?.category   ||
            'заявку'
          }»? Это действие нельзя отменить.`}
          confirmLabel="Удалить"
          onConfirm={() => onDeleteConfirmed(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          message={`Отменить заявку для «${
            requests.find(r => r.id === confirmCancel)?.visitorName ||
            requests.find(r => r.id === confirmCancel)?.category   ||
            'заявку'
          }»?`}
          confirmLabel="Да, отменить"
          cancelLabel="Нет"
          onConfirm={() => onCancelConfirmed(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </>
  );
}
