import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createRequestsOptimisticController } from '../services/consistency/requestsOptimistic';
import { useActions, useRequests } from '../store/AppStore';
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
import PassesTab from './resident/PassesTab';
import TechTab from './resident/TechTab';
import TemplatesTab from './resident/TemplatesTab';
import HistoryTab from './resident/HistoryTab';

const INACTIVE_STATUSES = new Set(['cancelled', 'rejected', 'expired']);
const COMPLETED_STATUSES = new Set(['arrived', 'rejected', 'expired', 'cancelled']);

export default function ResidentView({ user, activeTab, setActiveTab }) {
  const requests = useRequests();
  const { deleteRequest, updateRequest, addRequest } = useActions();
  const requestsRef = useRef(requests);
  const optimisticRef = useRef(createRequestsOptimisticController());
  const [modal,         setModal]         = useState(null);
  const [editReq,       setEditReq]       = useState(null);
  const [passFilter,    setPassFilter]    = useState('active');
  const [techFilter,    setTechFilter]    = useState('active');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);

  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);


  const onEdit = useCallback(r => { if (can(user).editRequest(r)) setEditReq(r); }, [user]);

  const onRepeatPass = useCallback(r => setModal({
    type: r.type, cat: r.category,
    data: { visitorName: r.visitorName, visitorPhone: r.visitorPhone, carPlate: r.carPlate, comment: r.comment },
  }), []);
  const onRepeatTech = useCallback(r => setModal({
    type: r.type, cat: r.category, data: { comment: r.comment },
  }), []);

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
      toast('Не удалось удалить заявку: ' + (e.message || 'ошибка сервера'), 'error');
    }
  }, [deleteRequest, updateRequest, addRequest]);

  const onDelete = useCallback((id) => setConfirmDelete(id), []);

  const onCancelConfirmed = useCallback(async id => {
    setConfirmCancel(null);
    const originalReq = requestsRef.current.find(r => r.id === id);
    if (!originalReq) return;
    const opId = optimisticRef.current.begin('cancel', originalReq);
    const patch = { status: 'cancelled' };
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
      toast('Не удалось отменить заявку: ' + (e.message || 'ошибка сервера'), 'error');
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
          setModal={setModal} setActiveTab={setActiveTab}
          onRepeatPass={onRepeatPass} onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
          computed={computed}
        />
      )}

      {activeTab === 'tech' && (
        <TechTab
          user={user}
          techFilter={techFilter} setTechFilter={setTechFilter}
          setModal={setModal}
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
        <TemplatesTab user={user} setModal={setModal} setActiveTab={setActiveTab} />
      )}

      {activeTab === 'history' && (
        <HistoryTab user={user} onRepeatPass={onRepeatPass} onRepeatTech={onRepeatTech} computed={computed} />
      )}

      {activeTab === 'chat' && <ChatView user={user} />}

      {modal   && <CreateModal key={modal.cat + '_' + modal.type} user={user} type={modal.type} initialCat={modal.cat} initialData={modal.data} onClose={() => setModal(null)} onDone={() => { setActiveTab(modal.type === 'tech' ? 'tech' : 'passes'); setModal(null); }} />}
      {editReq && <EditRequestModal req={editReq} onClose={() => setEditReq(null)} onDone={() => {}} />}

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
