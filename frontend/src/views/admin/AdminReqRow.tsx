import { useState, useEffect, useRef } from 'react';
import { useActions } from '../../store/AppStore';
import { STS_LABEL } from '../../constants';
import { ReqCard } from '../../requests/ReqCard';
import { toastBySyncResult } from '../../ui/syncFeedback';
import { toast } from '../../ui/Toasts';
import { services } from '../../services/providers/serviceContainer';
import { AppIcon } from '../../ui/AppIcon';
import type { AppRequest, RequestStatus } from '../../store/slices/requestsSlice';

type AdminReqRowProps = {
  r: AppRequest;
  adminUid: string;
};

export default function AdminReqRow({ r, adminUid }: AdminReqRowProps) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(r.comment || '');
  const [status,  setStatus]  = useState(r.status);

  // FIX [BUG]: состояние задублировало prop — при обновлении r через SSE форма показывала
  // устаревший статус/комментарий. Синхронизируем когда пользователь не редактирует.
  useEffect(() => {
    if (!editing) {
      setStatus(r.status);
      setComment(r.comment || '');
    }
  }, [r.status, r.comment, editing]);
  const { deleteRequest, updateRequest } = useActions();

  // FIX [LEAK]: isMountedRef — строка заявки может исчезнуть пока летит запрос
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  async function del() {
    try {
      const mode: Awaited<ReturnType<typeof services.requests.deleteEverywhere>> = await services.requests.deleteEverywhere({ requestId: r.id, deleteLocal: deleteRequest });
      if (!isMountedRef.current) return;
      toastBySyncResult(mode, 'Заявка удалена', 'Удаление выполнено локально. Синхронизация будет повторена позже');
    } catch { if (isMountedRef.current) toast('Ошибка удаления', 'error'); }
  }

  async function save() {
    try {
      const mode: Awaited<ReturnType<typeof services.requests.updateEverywhere>> = await services.requests.updateEverywhere({ requestId: r.id, patch: { comment, status }, updateLocal: updateRequest });
      if (!isMountedRef.current) return;
      setEditing(false);
      toastBySyncResult(mode, 'Заявка обновлена', 'Изменения сохранены локально. Синхронизация будет повторена позже');
    } catch { if (isMountedRef.current) toast('Ошибка сохранения заявки', 'error'); }
  }

  function handleCancel() { setEditing(false); }

  return (
    <div className="u-mb8 admin-req-shell">
      <ReqCard req={{ ...r, status }} userRole="admin" userName="Администратор" userId={adminUid} />
      <div className="u-flex u-gap6 admin-req-actions">
        <button className="btn-edit" onClick={() => setEditing(e => !e)} aria-label={editing ? 'Закрыть' : 'Редактировать'}>
          <AppIcon name={editing ? 'close' : 'edit'} className="u-inline-icon" /> Ред.
        </button>
        {/* Кнопка удаления всегда видна в AdminView — admin может удалять любые заявки */}
        <button className="btn-del-sm" onClick={del} aria-label="Удалить"><AppIcon name="trash" className="u-inline-icon" /> Удалить</button>
      </div>
      {editing && (
        <div className="edit-inline u-mt4">
          <div className="edit-inline-row">
            <select className="edit-inline-sel" value={status} onChange={e => setStatus(e.target.value as RequestStatus)}>
              {Object.entries(STS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="edit-inline-row">
            <input className="edit-inline-inp" placeholder="Комментарий" value={comment}
              onChange={e => setComment(e.target.value)} />
          </div>
          <div className="admin-user-actions-end">
            <button className="btn-outline" onClick={handleCancel}>Отмена</button>
            <button className="btn-gold u-pad-btn" onClick={save}><span>Сохранить</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
