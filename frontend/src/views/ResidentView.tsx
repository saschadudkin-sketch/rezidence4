import { useState, useCallback, useRef, useEffect } from 'react';
import { createRequestsOptimisticController } from '../services/consistency/requestsOptimistic';
import { useActions, useAppStoreSelector, useRequests } from '../store/AppStore';
import { CreateModal } from '../requests/CreateModal';
import { EditRequestModal } from '../requests/EditRequestModal';
import { PermsList } from '../perms/PermsList';
import { ChatView } from '../chat/ChatView';
import { toast } from '../ui/Toasts';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { can, ROLES } from '../domain/permissions';
import GarageView from './GarageView';
import { isLiveMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
import { presentError } from '../ui/errorPresenter';
import PassesTab from './resident/PassesTab';
import TechTab from './resident/TechTab';
import TemplatesTab from './resident/TemplatesTab';
import HistoryTab from './resident/HistoryTab';
import { PassReadySheet } from './resident/PassReadySheet';
import { useUrlSearchParams } from '../hooks/useUrlSearchParams';
import { makeSelectResidentComputed } from '../store/selectors/requestsSelectors';
import type { AppUser } from '../store/slices/usersSlice';
import type { AppRequest, RequestStatus, RequestType } from '../store/slices/requestsSlice';

type ResidentModalState = {
  type: RequestType;
  cat: string;
  data?: {
    visitorName?: unknown;
    visitorPhone?: unknown;
    carPlate?: unknown;
    comment?: unknown;
  };
  initialStep?: number;
  fast?: boolean;
};

type ResidentViewProps = {
  user: AppUser;
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

const _getRequestLabel = (request: AppRequest | undefined): string =>
  request?.visitorName || request?.category || 'заявку';

export default function ResidentView({ user, activeTab, setActiveTab }: ResidentViewProps) {
  const requests = useRequests();
  const { deleteRequest, updateRequest, addRequest } = useActions();
  const requestsRef = useRef(requests);
  const optimisticRef = useRef(createRequestsOptimisticController());
  const [modal,         setModal]         = useState<ResidentModalState | null>(null);
  const [editReq,       setEditReq]       = useState<AppRequest | null>(null);
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const passFilter = searchParams.get('passFilter') || 'active';
  const techFilter = searchParams.get('techFilter') || 'active';
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [readyPass, setReadyPass] = useState<AppRequest | null>(null);
  const computedSelectorRef = useRef(makeSelectResidentComputed());

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

  const onEdit = useCallback((request: AppRequest) => {
    if (can(user).editRequest(request)) setEditReq(request);
  }, [user]);

  const onRepeatPass = useCallback((request: AppRequest) => openModal({
    type: request.type, cat: request.category || 'guest',
    data: { visitorName: request.visitorName, visitorPhone: request.visitorPhone, carPlate: request.carPlate, comment: request.comment },
  }), [openModal]);
  const onRepeatTech = useCallback((request: AppRequest) => openModal({
    type: request.type, cat: request.category || 'service', data: { comment: request.comment },
  }), [openModal]);

  // T-6+: optimistic operation-log (not snapshot-only rollback)
  const onDeleteConfirmed = useCallback(async (id: string) => {
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

  const onDelete = useCallback((id: string) => setConfirmDelete(id), []);

  const onCancelConfirmed = useCallback(async (id: string) => {
    setConfirmCancel(null);
    const originalReq = requestsRef.current.find(r => r.id === id);
    if (!originalReq) return;
    const opId = optimisticRef.current.begin('cancel', originalReq);
    const patch: { status: RequestStatus } = { status: 'cancelled' };
    updateRequest(id, { ...patch, _optimisticOpId: opId });
    try {
      if (isLiveMode()) {
        await services.requests.updateEverywhere({ requestId: id, patch, historyLabel: 'Отменено жильцом', expectedCurrentStatus: originalReq.status });
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
      toast(presentError(e, 'request.update').message, 'error');
    }
  }, [updateRequest]);

  const onCancel = useCallback((id: string) => setConfirmCancel(id), []);

  const computed = useAppStoreSelector((state) => computedSelectorRef.current(state, user.uid, passFilter, techFilter));

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
          initialStep={modal.initialStep}
          initialFast={modal.fast}
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
