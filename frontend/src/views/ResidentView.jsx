import { useState, useMemo, useCallback } from 'react';
import { useActions, useRequests } from '../store/AppStore.jsx';
import { GroupedReqList, ReqCard } from '../requests/ReqCard.jsx';
import { CreateModal } from '../requests/CreateModal.jsx';
import { EditRequestModal } from '../requests/EditRequestModal.jsx';
import { PermsList, MyTemplates } from '../perms/PermsList.jsx';
import { ChatView } from '../chat/ChatView.jsx';
import { toast } from '../ui/Toasts.jsx';
import { can, ROLES } from '../domain/permissions';
import GarageView from './GarageView.jsx';
import { isLiveMode } from '../config/runtimeMode.js';
import { services } from '../services/providers/serviceContainer';
import { AppIcon } from '../ui/AppIcon.jsx';
import StateBlock from '../ui/StateBlock.jsx';

// FIX [PERF]: Set.has() O(1) вместо Array.includes() O(n) — вызывается при каждом фильтре
const INACTIVE_STATUSES = new Set(['cancelled', 'rejected', 'expired']);

// FIX [AUDIT]: вынесено за компонент — данные никогда не меняются,
// useMemo с [] создавало Set при каждом монтировании без пользы.
const COMPLETED_STATUSES = new Set(['arrived', 'rejected', 'expired', 'cancelled']);

export default function ResidentView({ user, activeTab, setActiveTab }) {
  const requests = useRequests();
  const { deleteRequest, updateRequest } = useActions();
  const [modal,      setModal]      = useState(null);
  const [editReq,    setEditReq]    = useState(null);
  const [passFilter, setPassFilter] = useState('active');
  const [techFilter, setTechFilter] = useState('active');
  // UX-003: confirm state для деструктивных действий (id заявки или null)
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);

  // FIX [DEPS-12]: [user] — объект в deps useCallback. React использует Object.is()
  // для сравнения: если parent передаёт новый объект user при каждом рендере (shallow copy),
  // onEdit пересоздаётся при каждом рендере ResidentView.
  // Используем примитивные deps user.uid + user.role — они стабильны.
  const onEdit = useCallback(r => { if (can(user).editRequest(r)) setEditReq(r); }, [user.uid, user.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX [PERF]: useCallback — не создаём новые функции при каждом рендере
  const onRepeatPass = useCallback(r => setModal({
    type: r.type, cat: r.category,
    data: { visitorName: r.visitorName, visitorPhone: r.visitorPhone, carPlate: r.carPlate, comment: r.comment },
  }), []);
  const onRepeatTech = useCallback(r => setModal({
    type: r.type, cat: r.category, data: { comment: r.comment },
  }), []);

  // FIX [DATA-3]: вызываем API перед обновлением локального стора.
  // FIX [PERF]: useCallback — не создаём новые функции при каждом рендере
  // UX-003: деструктивные действия проходят через confirm state
  const onDeleteConfirmed = useCallback(async id => {
    setConfirmDelete(null);
    try {
      if (isLiveMode()) {
        await services.requests.deleteEverywhere({ requestId: id });
      }
      deleteRequest(id);
      toast('Заявка удалена', 'success');
    } catch (e) {
      toast('Не удалось удалить заявку: ' + (e.message || 'ошибка сервера'), 'error');
    }
  }, [deleteRequest]);

  // onDelete теперь запрашивает подтверждение перед выполнением
  const onDelete = useCallback((id) => setConfirmDelete(id), []);

  const onCancelConfirmed = useCallback(async id => {
    setConfirmCancel(null);
    const patch = { status: 'cancelled' };
    try {
      if (isLiveMode()) {
        await services.requests.updateEverywhere({ requestId: id, patch, historyLabel: 'Отменено жильцом' });
      }
      updateRequest(id, patch);
      toast('Заявка отменена', 'success');
    } catch (e) {
      toast('Не удалось отменить заявку: ' + (e.message || 'ошибка сервера'), 'error');
    }
  }, [updateRequest]);

  // onCancel теперь запрашивает подтверждение перед выполнением
  const onCancel = useCallback((id) => setConfirmCancel(id), []);

  const myPasses = useMemo(() => requests.filter(r => r.createdByUid === user.uid && r.type === 'pass'), [requests, user.uid]);
  const myTech   = useMemo(() => requests.filter(r => r.createdByUid === user.uid && r.type === 'tech'), [requests, user.uid]);

  const scheduledPasses = useMemo(() => myPasses.filter(r => r.status === 'scheduled'), [myPasses]);

  const filteredPasses = useMemo(() => {
    const base = myPasses.filter(r => r.status !== 'scheduled');
    if (passFilter === 'all')       return base;
    if (passFilter === 'active')    return base.filter(r => !INACTIVE_STATUSES.has(r.status));
    if (passFilter === 'scheduled') return scheduledPasses;
    return base.filter(r => (r.passDuration || 'once') === passFilter);
  }, [myPasses, passFilter, scheduledPasses]);

  const filteredTech = useMemo(() => {
    if (techFilter === 'all') return myTech;
    return myTech.filter(r => !INACTIVE_STATUSES.has(r.status));
  }, [myTech, techFilter]);

  const tempCount      = useMemo(() => myPasses.filter(r => r.passDuration === 'temporary').length, [myPasses]);
  const permCount      = useMemo(() => myPasses.filter(r => r.passDuration === 'permanent').length, [myPasses]);
  const scheduledCount = scheduledPasses.length;

  // История — завершённые заявки для повтора
  // FIX [AUDIT]: COMPLETED_STATUSES теперь модульная константа (вынесена выше компонента)
  const completedRequests = useMemo(() =>
    requests
      .filter(r => r.createdByUid === user.uid && COMPLETED_STATUSES.has(r.status))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  [requests, user.uid]);

  // FIX [PERF]: passIcons мемоизирован — массив не пересоздаётся при каждом рендере
  const passIcons = useMemo(() =>
    user.role === 'contractor'
      ? [['worker','tools','Рабочий'],['team','users','Бригада'],['delivery','car','Доставка'],['car','car','Авто']]
      : [['guest','users','Гость'],['courier','file','Курьер'],['taxi','car','Такси'],['car','car','Авто'],['master','tools','Мастер']],
  [user.role]);

  return (
    <>
      {activeTab === 'passes' && (
        <>
          <div className="type-grid">
            {passIcons.map(([k, iconName, l]) => (
              <div key={k} className="type-card" role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.click()}
                onClick={() => setModal({ type: 'pass', cat: k })}>
                <div className="type-icon"><AppIcon name={iconName} /></div>
                <div className="type-label">{l}</div>
              </div>
            ))}
            <div role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.click()}
              onClick={() => setActiveTab('templates')}
              className={"type-card" + (activeTab === 'templates' ? ' selected' : '')}>
              <div className="type-icon"><AppIcon name="file" /></div>
              <div className="type-label">Шаблоны</div>
            </div>
          </div>
          {myPasses.length > 0 && (
            <div className="pass-filter-pills">
              {[
                ['active',    'Активные',           0],
                ['scheduled', 'Запланированные', scheduledCount],
                ['all',       'Все',                myPasses.length],
                ['temporary', 'Временные',       tempCount],
                ['permanent', 'Постоянные',       permCount],
                ['once',      'Разовые',             myPasses.length - tempCount - permCount],
              ].map(([k, l, c]) =>
                c > 0 || k === 'all' || k === 'active' ? (
                  <button key={k}
                    className={'date-pill' + (passFilter === k ? ' active' : '')}
                    onClick={() => setPassFilter(k)}>
                    {l}{c > 0 && k !== 'all' && k !== 'active' ? ` (${c})` : ''}
                  </button>
                ) : null
              )}
            </div>
          )}
          {filteredPasses.length === 0 && myPasses.length === 0
            ? <StateBlock
                type="empty"
                title="Пропусков пока нет"
                subtitle="Нажмите на категорию выше, чтобы создать первый пропуск"
              />
            : filteredPasses.length === 0
              ? <StateBlock type="empty" title="Нет пропусков в этой категории" />
              : <>
                  {scheduledPasses.length > 0 && passFilter !== 'scheduled' && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="sec-divider-label"><AppIcon name="history" className="u-inline-icon" /> Запланированные ({scheduledPasses.length})</div>
                      <GroupedReqList reqs={scheduledPasses} userRole={user.role} userName={user.name} userId={user.uid}
                        onRepeat={onRepeatPass}
                        onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
                      />
                    </div>
                  )}
                  <GroupedReqList
                    reqs={filteredPasses} userRole={user.role} userName={user.name} userId={user.uid}
                    onRepeat={onRepeatPass}
                    onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
                  />
                </>
          }
        </>
      )}

      {activeTab === 'tech' && (
        <>
          <div className="type-grid">
            {[['electrician','alert','Электрик'],['plumber','tools','Сантехник']].map(([k, iconName, l]) => (
              <div key={k} className="type-card" role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.click()}
                onClick={() => setModal({ type: 'tech', cat: k })}>
                <div className="type-icon"><AppIcon name={iconName} /></div>
                <div className="type-label">{l}</div>
              </div>
            ))}
            <div role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.click()}
              onClick={() => setActiveTab('templates')}
              className={"type-card" + (activeTab === 'templates' ? ' selected' : '')}>
              <div className="type-icon"><AppIcon name="file" /></div>
              <div className="type-label">Шаблоны</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {[['active','Активные'],['all','Все']].map(([k, l]) => (
              <button key={k} className={'date-pill' + (techFilter === k ? ' active' : '')} onClick={() => setTechFilter(k)}>{l}</button>
            ))}
          </div>
          {filteredTech.length === 0
            ? <StateBlock
                type="empty"
                title="Заявок нет"
                subtitle="Нажмите на категорию выше, чтобы вызвать техслужбу"
              />
            : <GroupedReqList
                reqs={filteredTech} userRole={user.role} userName={user.name} userId={user.uid}
                onRepeat={onRepeatTech}
                onEdit={onEdit} onDelete={onDelete} onCancel={onCancel}
              />
          }
        </>
      )}

      {activeTab === 'perms' && (
        <div>
          <PermsList user={user} />
          {user.role !== ROLES.CONTRACTOR && <GarageView user={user} />}
        </div>
      )}
      {activeTab === 'templates' && (<>
        <button className="btn-outline" style={{ marginBottom: 16 }} onClick={() => setActiveTab('passes')}>
          ← Назад к пропускам
        </button>
        <MyTemplates user={user} onUse={t => {
          setModal({ type: t.type, cat: t.category, data: {
            visitorName: t.visitorName, visitorPhone: t.visitorPhone,
            carPlate: t.carPlate, comment: t.comment,
          } });
        }} />
      </>)}

      {/* ── История заявок с кнопкой «Повторить» ────────────────────── */}
      {activeTab === 'history' && (
        <div>
          {completedRequests.length === 0 ? (
            <StateBlock
              type="empty"
              title="Нет завершённых заявок"
              subtitle="Здесь появятся завершённые, отклонённые и отменённые заявки"
            />
          ) : (
            <div className="req-list">
              {completedRequests.map((r, i) => (
                <ReqCard
                  key={r.id}
                  req={r}
                  staggerIdx={i}
                  userRole={user.role}
                  userName={user.name}
                  userId={user.uid}
                  onRepeat={r.type === 'tech' ? onRepeatTech : onRepeatPass}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && <ChatView user={user} />}

      {modal   && <CreateModal key={modal.cat + '_' + modal.type} user={user} type={modal.type} initialCat={modal.cat} initialData={modal.data} onClose={() => setModal(null)} onDone={() => { setActiveTab(modal.type === 'tech' ? 'tech' : 'passes'); setModal(null); }} />}
      {editReq && <EditRequestModal req={editReq} onClose={() => setEditReq(null)} onDone={() => {}} />}

      {/* UX-003: confirm-диалог для удаления заявки */}
      {confirmDelete && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Подтверждение удаления">
          <div className="confirm-panel">
            <p className="confirm-msg">Удалить заявку? Это действие нельзя отменить.</p>
            <div className="confirm-actions">
              <button className="btn-no" onClick={() => onDeleteConfirmed(confirmDelete)}>Удалить</button>
              <button className="btn-outline" onClick={() => setConfirmDelete(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* UX-003: confirm-диалог для отмены заявки */}
      {confirmCancel && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Подтверждение отмены">
          <div className="confirm-panel">
            <p className="confirm-msg">Отменить заявку?</p>
            <div className="confirm-actions">
              <button className="btn-no" onClick={() => onCancelConfirmed(confirmCancel)}>Да, отменить</button>
              <button className="btn-outline" onClick={() => setConfirmCancel(null)}>Нет</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
