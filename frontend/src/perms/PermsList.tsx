import { useState, useCallback, useRef, useEffect } from 'react';
import { ROLES } from '../domain/permissions';
import { useActions, usePerms, useTemplates } from '../store/AppStore';
import { CAT_LABEL } from '../constants/index';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { services } from '../services/providers/serviceContainer';
import { isLiveMode } from '../config/runtimeMode';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';

// ─── PermsList ────────────────────────────────────────────────────────────────

export function PermsList({ user }) {
  const isContractor = user.role === ROLES.CONTRACTOR;
  const perms = usePerms(user.uid);
  const { setPerms: localSetPerms } = useActions();
  const [addingV,  setAddingV]  = useState(false);
  const [addingW,  setAddingW]  = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [vForm,    setVForm]    = useState({ name: '', phone: '' });
  const [wForm,    setWForm]    = useState({ name: '', phone: '', carPlate: '' });

  // FIX [AUDIT-5 #3]: save now also syncs with backend in live mode.
  // Previously only dispatched to local store — perms lost on page refresh.
  // Pattern: optimistic local update + fire-and-forget API sync.
  // Success toast is shown by the CALLER (addVisitor, delWorker etc.), not here.
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  const save = useCallback(async (next) => {
    // 1. Optimistic update — immediate UI response
    localSetPerms(user.uid, next);
    // 2. Sync with backend (fire-and-forget — don't block UI)
    if (isLiveMode()) {
      try {
        await services.admin.savePermsEverywhere({ uid: user.uid, perms: next });
      } catch (e) {
        if (isMountedRef.current) toast('Ошибка синхронизации: ' + (e.message || ''), 'warning');
      }
    }
  }, [localSetPerms, user.uid]);

  // FIX [AUDIT-6 PERF]: permsRef — delVisitor/delWorker не зависят от perms (не пересоздаются)
  const permsRef = useRef(perms);
  permsRef.current = perms;

  const addVisitor = () => {
    if (!vForm.name.trim()) { toast('Введите ФИО', 'error'); return; }
    save({ ...permsRef.current, visitors: [...permsRef.current.visitors, { id: genId('pv'), ...vForm }] });
    setVForm({ name: '', phone: '' }); setAddingV(false);
    toast('Посетитель добавлен', 'success');
  };
  const addWorker = () => {
    if (!wForm.name.trim()) { toast('Введите ФИО', 'error'); return; }
    save({ ...permsRef.current, workers: [...permsRef.current.workers, { id: genId('pw'), ...wForm }] });
    setWForm({ name: '', phone: '', carPlate: '' }); setAddingW(false);
    toast('Рабочий добавлен', 'success');
  };
  const delVisitor = useCallback(id => {
    const p = permsRef.current;
    save({ ...p, visitors: p.visitors.filter(v => v.id !== id) });
    toast('Удалено', 'success');
  }, [save]);
  const delWorker = useCallback(id => {
    const p = permsRef.current;
    save({ ...p, workers: p.workers.filter(w => w.id !== id) });
    toast('Удалено', 'success');
  }, [save]);

  const startEdit = (item, type) => {
    setEditId(item.id);
    if (type === 'visitor') setVForm({ name: item.name, phone: item.phone || '' });
    else setWForm({ name: item.name, phone: item.phone || '', carPlate: item.carPlate || '' });
  };
  const saveEdit = type => {
    const p = permsRef.current;
    if (type === 'visitor') {
      if (!vForm.name.trim()) { toast('Введите ФИО', 'error'); return; }
      save({ ...p, visitors: p.visitors.map(v => v.id === editId ? { ...v, ...vForm } : v) });
    } else {
      if (!wForm.name.trim()) { toast('Введите ФИО', 'error'); return; }
      save({ ...p, workers: p.workers.map(w => w.id === editId ? { ...w, ...wForm } : w) });
    }
    setEditId(null);
    toast('Сохранено', 'success');
  };

  return (
    <div className="perms-wrap">
      {!isContractor && (
        <div className="perms-section">
          <div className="perms-title">Постоянные посетители</div>
          {perms.visitors.map(v => (
            <div key={v.id} className="perm-row u-col-stretch">
              {editId === v.id
                ? (
                  <div className="perm-form">
                    <div className="perm-form-row">
                      <input className="perm-form-inp" placeholder="ФИО *" value={vForm.name} onChange={e => setVForm(f => ({ ...f, name: e.target.value }))} autoCapitalize="words" autoFocus />
                      <input className="perm-form-inp" placeholder="Телефон" type="tel" value={vForm.phone} onChange={e => setVForm(f => ({ ...f, phone: e.target.value }))} inputMode="tel" />
                    </div>
                    <div className="perm-form-btns">
                      <button className="btn-outline" onClick={() => setEditId(null)}>Отмена</button>
                      <button className="btn-gold u-pad-btn" onClick={() => saveEdit('visitor')}><span>Сохранить</span></button>
                    </div>
                  </div>
                )
                : (
                  <div className="u-row-full">
                    <div className="perm-info u-flex1">
                      <div className="perm-name">{v.name}</div>
                      {v.phone && <div className="perm-meta">{v.phone}</div>}
                    </div>
                    <button className="btn-edit u-mr6" onClick={() => startEdit(v, 'visitor')} aria-label="Редактировать"><AppIcon name="edit" /></button>
                    <button className="perm-del" onClick={() => delVisitor(v.id)} aria-label="Удалить"><AppIcon name="close" /></button>
                  </div>
                )
              }
            </div>
          ))}
          {addingV
            ? (
              <div className="perm-form">
                <div className="perm-form-row">
                  <input className="perm-form-inp" placeholder="ФИО *" value={vForm.name} onChange={e => setVForm(f => ({ ...f, name: e.target.value }))} autoCapitalize="words" />
                  <input className="perm-form-inp" placeholder="Телефон" type="tel" value={vForm.phone} onChange={e => setVForm(f => ({ ...f, phone: e.target.value }))} inputMode="tel" />
                </div>
                <div className="perm-form-btns">
                  <button className="btn-outline" onClick={() => { setAddingV(false); setVForm({ name: '', phone: '' }); }}>Отмена</button>
                  <button className="btn-gold u-pad-btn" onClick={addVisitor}><span>Добавить</span></button>
                </div>
              </div>
            )
            : <button className="perm-add" onClick={() => { setEditId(null); setAddingV(true); }}>＋ Добавить посетителя</button>
          }
        </div>
      )}

      <div className="perms-section">
        <div className="perms-title">{isContractor ? 'Постоянные рабочие' : 'Постоянные рабочие / мастера'}</div>
        {perms.workers.map(w => (
          <div key={w.id} className="perm-row u-col-stretch">
            {editId === w.id
              ? (
                <div className="perm-form">
                  <div className="perm-form-row">
                    <input className="perm-form-inp" placeholder="ФИО *" value={wForm.name} onChange={e => setWForm(f => ({ ...f, name: e.target.value }))} autoCapitalize="words" autoFocus />
                    <input className="perm-form-inp" placeholder="Телефон" type="tel" value={wForm.phone} onChange={e => setWForm(f => ({ ...f, phone: e.target.value }))} inputMode="tel" />
                  </div>
                  <div className="perm-form-row">
                    <input className="perm-form-inp" placeholder="Авто (марка, номер)" value={wForm.carPlate} onChange={e => setWForm(f => ({ ...f, carPlate: e.target.value }))} autoCapitalize="characters" />
                  </div>
                  <div className="perm-form-btns">
                    <button className="btn-outline" onClick={() => setEditId(null)}>Отмена</button>
                    <button className="btn-gold u-pad-btn" onClick={() => saveEdit('worker')}><span>Сохранить</span></button>
                  </div>
                </div>
              )
              : (
                <div className="u-row-full">
                  <div className="perm-info u-flex1">
                    <div className="perm-name">{w.name}</div>
                    <div className="perm-meta">{[w.phone, w.carPlate].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button className="btn-edit u-mr6" onClick={() => startEdit(w, 'worker')} aria-label="Редактировать"><AppIcon name="edit" /></button>
                  <button className="perm-del" onClick={() => delWorker(w.id)} aria-label="Удалить"><AppIcon name="close" /></button>
                </div>
              )
            }
          </div>
        ))}
        {addingW
          ? (
            <div className="perm-form">
              <div className="perm-form-row">
                <input className="perm-form-inp" placeholder="ФИО *" value={wForm.name} onChange={e => setWForm(f => ({ ...f, name: e.target.value }))} autoCapitalize="words" />
                <input className="perm-form-inp" placeholder="Телефон" type="tel" value={wForm.phone} onChange={e => setWForm(f => ({ ...f, phone: e.target.value }))} inputMode="tel" />
              </div>
              <div className="perm-form-row">
                <input className="perm-form-inp" placeholder="Авто (марка, номер)" value={wForm.carPlate} onChange={e => setWForm(f => ({ ...f, carPlate: e.target.value }))} autoCapitalize="characters" />
              </div>
              <div className="perm-form-btns">
                <button className="btn-outline" onClick={() => { setAddingW(false); setWForm({ name: '', phone: '', carPlate: '' }); }}>Отмена</button>
                <button className="btn-gold u-pad-btn" onClick={addWorker}><span>Добавить</span></button>
              </div>
            </div>
          )
          : <button className="perm-add" onClick={() => { setEditId(null); setAddingW(true); }}>＋ Добавить рабочего</button>
        }
      </div>
    </div>
  );
}

// ─── MyTemplates ──────────────────────────────────────────────────────────────

export function MyTemplates({ user, onUse }) {
  const tpls = useTemplates(user.uid);
  const { deleteTemplate } = useActions();
  const templatesEmptyCopy = getViewStateCopy('templates', 'empty');
  // FIX [PERF]: useCallback — del вызывается для каждого шаблона в списке
  const del = useCallback(id => { deleteTemplate(user.uid, id); toast('Шаблон удалён', 'success'); }, [deleteTemplate, user.uid]);

  if (tpls.length === 0) return (
    <StateBlock
      type="empty"
      title={templatesEmptyCopy.title}
      subtitle={templatesEmptyCopy.subtitle}
    />
  );

  const passes = tpls.filter(t => t.type === 'pass');
  const tech   = tpls.filter(t => t.type === 'tech');

  return (
    <div>
      {passes.length > 0 && (
        <div className="u-mb20">
          <div className="tpl-section-hdr"><AppIcon name="ticket" className="u-inline-icon" /> Пропуска</div>
          <div className="tpl-list">
            {passes.map(t => (
              <div key={t.id} className="tpl-row" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && e.currentTarget.click()} onClick={() => onUse(t)}>
                <span className="tpl-ico"><AppIcon name="ticket" /></span>
                <div className="tpl-info">
                  <div className="tpl-name">{t.name}</div>
                  <div className="tpl-meta">{CAT_LABEL[t.category]}{t.visitorName ? ' · ' + t.visitorName : ''}{t.comment ? ' · ' + t.comment : ''}</div>
                </div>
                <button className="tpl-del" onClick={e => { e.stopPropagation(); del(t.id); }} title="Удалить" aria-label="Удалить"><AppIcon name="close" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tech.length > 0 && (
        <div>
          <div className="tpl-section-hdr"><AppIcon name="tools" className="u-inline-icon" /> Техслужба</div>
          <div className="tpl-list">
            {tech.map(t => (
              <div key={t.id} className="tpl-row" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && e.currentTarget.click()} onClick={() => onUse(t)}>
                <span className="tpl-ico"><AppIcon name="tools" /></span>
                <div className="tpl-info">
                  <div className="tpl-name">{t.name}</div>
                  <div className="tpl-meta">{CAT_LABEL[t.category]}{t.comment ? ' · ' + t.comment : ''}</div>
                </div>
                <button className="tpl-del" onClick={e => { e.stopPropagation(); del(t.id); }} title="Удалить" aria-label="Удалить"><AppIcon name="close" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="u-mt12 u-fs11 u-t4 u-center">
        Нажмите на шаблон чтобы создать заявку
      </div>
    </div>
  );
}
