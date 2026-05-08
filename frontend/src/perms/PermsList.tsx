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
import type { Template, PermEntry, UserPerms } from '../store/slices/permsSlice';
import type { AppUser } from '../store/slices/usersSlice';

type FormState = {
  name: string;
  phone: string;
  carPlate: string;
};

type MyTemplatesProps = {
  user: Pick<AppUser, 'uid'>;
  onUse: (template: Template) => void;
};

const EMPTY_FORM: FormState = { name: '', phone: '', carPlate: '' };

const getCategoryLabel = (category: string): string =>
  CAT_LABEL[category as keyof typeof CAT_LABEL] || category;

const normalizePerms = (value: {
  visitors?: readonly PermEntry[];
  workers?: readonly PermEntry[];
}): UserPerms => ({
  visitors: [...(value.visitors || [])],
  workers: [...(value.workers || [])],
});

export function PermsList({ user }: { user: AppUser }) {
  const isContractor = user.role === ROLES.CONTRACTOR;
  const perms = usePerms(user.uid);
  const { setPerms: localSetPerms } = useActions();
  const [addingV, setAddingV] = useState(false);
  const [addingW, setAddingW] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [vForm, setVForm] = useState<FormState>(EMPTY_FORM);
  const [wForm, setWForm] = useState<FormState>(EMPTY_FORM);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const save = useCallback(async (next: UserPerms) => {
    localSetPerms(user.uid, next);
    if (isLiveMode()) {
      try {
        await services.admin.savePermsEverywhere({ uid: user.uid, perms: next });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (isMountedRef.current) toast('Ошибка синхронизации: ' + message, 'warning');
      }
    }
  }, [localSetPerms, user.uid]);

  const permsRef = useRef<UserPerms>(normalizePerms(perms));
  permsRef.current = normalizePerms(perms);

  const addVisitor = () => {
    if (!vForm.name.trim()) {
      toast('Введите ФИО', 'error');
      return;
    }
    save({ ...permsRef.current, visitors: [...permsRef.current.visitors, { id: genId('pv'), ...vForm }] });
    setVForm(EMPTY_FORM);
    setAddingV(false);
    toast('Посетитель добавлен', 'success');
  };

  const addWorker = () => {
    if (!wForm.name.trim()) {
      toast('Введите ФИО', 'error');
      return;
    }
    save({ ...permsRef.current, workers: [...permsRef.current.workers, { id: genId('pw'), ...wForm }] });
    setWForm(EMPTY_FORM);
    setAddingW(false);
    toast('Рабочий добавлен', 'success');
  };

  const delVisitor = useCallback((id: string) => {
    const next = permsRef.current;
    save({ ...next, visitors: next.visitors.filter((visitor) => visitor.id !== id) });
    toast('Удалено', 'success');
  }, [save]);

  const delWorker = useCallback((id: string) => {
    const next = permsRef.current;
    save({ ...next, workers: next.workers.filter((worker) => worker.id !== id) });
    toast('Удалено', 'success');
  }, [save]);

  const startEdit = (item: PermEntry, type: 'visitor' | 'worker') => {
    setEditId(item.id);
    const nextForm = { name: item.name, phone: item.phone || '', carPlate: item.carPlate || '' };
    if (type === 'visitor') setVForm(nextForm);
    else setWForm(nextForm);
  };

  const saveEdit = (type: 'visitor' | 'worker') => {
    const next = permsRef.current;
    if (type === 'visitor') {
      if (!vForm.name.trim()) {
        toast('Введите ФИО', 'error');
        return;
      }
      save({ ...next, visitors: next.visitors.map((visitor) => visitor.id === editId ? { ...visitor, ...vForm } : visitor) });
    } else {
      if (!wForm.name.trim()) {
        toast('Введите ФИО', 'error');
        return;
      }
      save({ ...next, workers: next.workers.map((worker) => worker.id === editId ? { ...worker, ...wForm } : worker) });
    }
    setEditId(null);
    toast('Сохранено', 'success');
  };

  return (
    <div className="perms-wrap">
      {!isContractor && (
        <div className="perms-section">
          <div className="perms-title">Постоянные посетители</div>
          {perms.visitors.map((visitor) => (
            <div key={visitor.id} className="perm-row u-col-stretch">
              {editId === visitor.id ? (
                <div className="perm-form">
                  <div className="perm-form-row">
                    <input className="perm-form-inp" aria-label="ФИО посетителя" placeholder="ФИО *" value={vForm.name} onChange={(event) => setVForm((form) => ({ ...form, name: event.target.value }))} autoCapitalize="words" autoFocus />
                    <input className="perm-form-inp" aria-label="Телефон посетителя" placeholder="Телефон" type="tel" value={vForm.phone} onChange={(event) => setVForm((form) => ({ ...form, phone: event.target.value }))} inputMode="tel" />
                  </div>
                  <div className="perm-form-row">
                    <input className="perm-form-inp" aria-label="Авто посетителя" placeholder="Авто (марка, номер)" value={vForm.carPlate} onChange={(event) => setVForm((form) => ({ ...form, carPlate: event.target.value }))} autoCapitalize="characters" />
                  </div>
                  <div className="perm-form-btns">
                    <button className="btn-outline" onClick={() => setEditId(null)}>Отмена</button>
                    <button className="btn-gold u-pad-btn" onClick={() => saveEdit('visitor')}><span>Сохранить</span></button>
                  </div>
                </div>
              ) : (
                <div className="u-row-full">
                  <div className="perm-info u-flex1">
                    <div className="perm-name">{visitor.name}</div>
                    <div className="perm-meta">{[visitor.phone, visitor.carPlate].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button className="btn-edit u-mr6" onClick={() => startEdit(visitor, 'visitor')} aria-label="Редактировать"><AppIcon name="edit" /></button>
                  <button className="perm-del" onClick={() => delVisitor(visitor.id)} aria-label="Удалить"><AppIcon name="close" /></button>
                </div>
              )}
            </div>
          ))}
          {addingV ? (
            <div className="perm-form">
              <div className="perm-form-row">
                <input className="perm-form-inp" aria-label="ФИО посетителя" placeholder="ФИО *" value={vForm.name} onChange={(event) => setVForm((form) => ({ ...form, name: event.target.value }))} autoCapitalize="words" />
                <input className="perm-form-inp" aria-label="Телефон посетителя" placeholder="Телефон" type="tel" value={vForm.phone} onChange={(event) => setVForm((form) => ({ ...form, phone: event.target.value }))} inputMode="tel" />
              </div>
              <div className="perm-form-row">
                <input className="perm-form-inp" aria-label="Авто посетителя" placeholder="Авто (марка, номер)" value={vForm.carPlate} onChange={(event) => setVForm((form) => ({ ...form, carPlate: event.target.value }))} autoCapitalize="characters" />
              </div>
              <div className="perm-form-btns">
                <button className="btn-outline" onClick={() => { setAddingV(false); setVForm(EMPTY_FORM); }}>Отмена</button>
                <button className="btn-gold u-pad-btn" onClick={addVisitor}><span>Добавить</span></button>
              </div>
            </div>
          ) : (
            <button className="perm-add" onClick={() => { setEditId(null); setVForm(EMPTY_FORM); setAddingV(true); }}>＋ Добавить посетителя</button>
          )}
        </div>
      )}

      <div className="perms-section">
        <div className="perms-title">{isContractor ? 'Постоянные рабочие' : 'Постоянные рабочие / мастера'}</div>
        {perms.workers.map((worker) => (
          <div key={worker.id} className="perm-row u-col-stretch">
            {editId === worker.id ? (
              <div className="perm-form">
                <div className="perm-form-row">
                  <input className="perm-form-inp" aria-label="ФИО рабочего" placeholder="ФИО *" value={wForm.name} onChange={(event) => setWForm((form) => ({ ...form, name: event.target.value }))} autoCapitalize="words" autoFocus />
                  <input className="perm-form-inp" aria-label="Телефон рабочего" placeholder="Телефон" type="tel" value={wForm.phone} onChange={(event) => setWForm((form) => ({ ...form, phone: event.target.value }))} inputMode="tel" />
                </div>
                <div className="perm-form-row">
                  <input className="perm-form-inp" aria-label="Авто рабочего" placeholder="Авто (марка, номер)" value={wForm.carPlate} onChange={(event) => setWForm((form) => ({ ...form, carPlate: event.target.value }))} autoCapitalize="characters" />
                </div>
                <div className="perm-form-btns">
                  <button className="btn-outline" onClick={() => setEditId(null)}>Отмена</button>
                  <button className="btn-gold u-pad-btn" onClick={() => saveEdit('worker')}><span>Сохранить</span></button>
                </div>
              </div>
            ) : (
              <div className="u-row-full">
                <div className="perm-info u-flex1">
                  <div className="perm-name">{worker.name}</div>
                  <div className="perm-meta">{[worker.phone, worker.carPlate].filter(Boolean).join(' · ')}</div>
                </div>
                <button className="btn-edit u-mr6" onClick={() => startEdit(worker, 'worker')} aria-label="Редактировать"><AppIcon name="edit" /></button>
                <button className="perm-del" onClick={() => delWorker(worker.id)} aria-label="Удалить"><AppIcon name="close" /></button>
              </div>
            )}
          </div>
        ))}
        {addingW ? (
          <div className="perm-form">
            <div className="perm-form-row">
              <input className="perm-form-inp" aria-label="ФИО рабочего" placeholder="ФИО *" value={wForm.name} onChange={(event) => setWForm((form) => ({ ...form, name: event.target.value }))} autoCapitalize="words" />
              <input className="perm-form-inp" aria-label="Телефон рабочего" placeholder="Телефон" type="tel" value={wForm.phone} onChange={(event) => setWForm((form) => ({ ...form, phone: event.target.value }))} inputMode="tel" />
            </div>
            <div className="perm-form-row">
              <input className="perm-form-inp" aria-label="Авто рабочего" placeholder="Авто (марка, номер)" value={wForm.carPlate} onChange={(event) => setWForm((form) => ({ ...form, carPlate: event.target.value }))} autoCapitalize="characters" />
            </div>
            <div className="perm-form-btns">
              <button className="btn-outline" onClick={() => { setAddingW(false); setWForm(EMPTY_FORM); }}>Отмена</button>
              <button className="btn-gold u-pad-btn" onClick={addWorker}><span>Добавить</span></button>
            </div>
          </div>
        ) : (
          <button className="perm-add" onClick={() => { setEditId(null); setWForm(EMPTY_FORM); setAddingW(true); }}>＋ Добавить рабочего</button>
        )}
      </div>
    </div>
  );
}

export function MyTemplates({ user, onUse }: MyTemplatesProps) {
  const templates = useTemplates(user.uid);
  const { deleteTemplate } = useActions();
  const templatesEmptyCopy = getViewStateCopy('templates', 'empty');

  const del = useCallback((id: string) => {
    deleteTemplate(user.uid, id);
    toast('Шаблон удалён', 'success');
  }, [deleteTemplate, user.uid]);

  if (templates.length === 0) {
    return (
      <StateBlock
        type="empty"
        title={templatesEmptyCopy.title}
        subtitle={templatesEmptyCopy.subtitle}
      />
    );
  }

  const passes = templates.filter((template) => template.type === 'pass');
  const tech = templates.filter((template) => template.type === 'tech');

  return (
    <div>
      {passes.length > 0 && (
        <div className="u-mb20">
          <div className="tpl-section-hdr"><AppIcon name="ticket-line" className="u-inline-icon" /> Пропуска</div>
          <div className="tpl-list">
            {passes.map((template) => (
              <div key={template.id} className="tpl-row" role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.click()} onClick={() => onUse(template)}>
                <span className="tpl-ico"><AppIcon name="ticket-line" /></span>
                <div className="tpl-info">
                  <div className="tpl-name">{template.name}</div>
                  <div className="tpl-meta">{getCategoryLabel(template.category)}{template.visitorName ? ' · ' + template.visitorName : ''}{template.comment ? ' · ' + template.comment : ''}</div>
                </div>
                <button className="tpl-del" onClick={(event) => { event.stopPropagation(); del(template.id); }} title="Удалить" aria-label="Удалить"><AppIcon name="close" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tech.length > 0 && (
        <div>
          <div className="tpl-section-hdr"><AppIcon name="tools-line" className="u-inline-icon" /> Техслужба</div>
          <div className="tpl-list">
            {tech.map((template) => (
              <div key={template.id} className="tpl-row" role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.click()} onClick={() => onUse(template)}>
                <span className="tpl-ico"><AppIcon name="tools-line" /></span>
                <div className="tpl-info">
                  <div className="tpl-name">{template.name}</div>
                  <div className="tpl-meta">{getCategoryLabel(template.category)}{template.comment ? ' · ' + template.comment : ''}</div>
                </div>
                <button className="tpl-del" onClick={(event) => { event.stopPropagation(); del(template.id); }} title="Удалить" aria-label="Удалить"><AppIcon name="close" /></button>
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
