import { useState, useMemo, useRef, useEffect } from 'react';
import { useActions, useUsers, useAllPerms, usePerms } from '../../store/AppStore';
import { ROLE_LABELS } from '../../constants';
import { genId } from '../../utils';
import { useDebounce } from '../../hooks/useDebounce';
import { toast } from '../../ui/Toasts';
import { toastBySyncResult } from '../../ui/syncFeedback';
import { services } from '../../services/providers/serviceContainer';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import { getViewStateCopy } from '../../ui/viewStateContract';
import type { PermEntry, UserPerms } from '../../store/slices/permsSlice';
import type { AppUser } from '../../store/slices/usersSlice';

type PermListKey = keyof UserPerms;
type AdminPermsItemRowProps = {
  uid: string;
  listKey: PermListKey;
  item: PermEntry;
  onDel: () => void;
};
type AdminPermsAptGroupProps = {
  u: AppUser;
  tab: PermListKey;
};
const EMPTY_PERMS: UserPerms = { visitors: [], workers: [] };
const ROLE_FILTERS = [
  ['all', 'Р’СЃРµ'],
  ['owner', 'РЎРѕР±СЃС‚РІРµРЅРЅРёРєРё'],
  ['tenant', 'РђСЂРµРЅРґР°С‚РѕСЂС‹'],
  ['contractor', 'РџРѕРґСЂСЏРґС‡РёРєРё'],
] as const;

// ─── AdminPermsItemRow ────────────────────────────────────────────────────────

function AdminPermsItemRow({ uid, listKey, item, onDel }: AdminPermsItemRowProps) {
  const isWorker = listKey === 'workers';
  const [editing,  setEditing]  = useState(false);
  const [name,     setName]     = useState(item.name);
  const [phone,    setPhone]    = useState(item.phone || '');
  const [carPlate, setCarPlate] = useState(item.carPlate || '');
  const perms = usePerms(uid);
  const { setPerms } = useActions();

  // FIX [LEAK]: isMountedRef — PermItem может размонтироваться пока запрос летит
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  async function save() {
    if (!name.trim()) { toast('Введите ФИО', 'error'); return; }
    const updated = {
      ...perms,
      [listKey]: (perms[listKey] || []).map((x: PermEntry) =>
        x.id === item.id ? { ...x, name: name.trim(), phone, carPlate } : x
      ),
    };
    let mode: Awaited<ReturnType<typeof services.admin.savePermsEverywhere>>;
    try {
      mode = await services.admin.savePermsEverywhere({ uid, perms: updated, saveLocal: setPerms });
    } catch {
      if (isMountedRef.current) toast('Ошибка сохранения', 'error');
      return;
    }
    if (!isMountedRef.current) return;
    setEditing(false);
    toastBySyncResult(mode, 'Запись обновлена', 'Запись сохранена локально. Синхронизация будет повторена позже');
  }

  function handleCancel() { setEditing(false); }

  return (
    <div>
      <div className={'perm-row ' + (editing ? 'admin-perm-row--editing' : '')}>
        <div className="perm-info">
          <div className="perm-name">{item.name}</div>
          <div className="perm-meta">{[item.phone, item.carPlate].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="u-row-g4-fs0">
          <button className="btn-edit" onClick={() => setEditing(e => !e)} aria-label={editing ? 'Закрыть' : 'Редактировать'}>
            <AppIcon name={editing ? 'close' : 'edit'} />
          </button>
          <button className="perm-del" onClick={onDel} title="Удалить" aria-label="Удалить"><AppIcon name="trash" /></button>
        </div>
      </div>
      {editing && (
        <div className="edit-inline admin-perm-edit-inline">
          <div className="edit-inline-row">
            <input className="edit-inline-inp" placeholder="ФИО *" value={name} onChange={e => setName(e.target.value)} autoCapitalize="words" />
            <input className="edit-inline-inp" placeholder="Телефон" type="tel" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
          </div>
          {isWorker && (
            <div className="edit-inline-row">
              <input className="edit-inline-inp" placeholder="Авто (марка, номер)" value={carPlate} onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
            </div>
          )}
          <div className="admin-user-actions-end">
            <button className="btn-outline" onClick={handleCancel}>Отмена</button>
            <button className="btn-gold u-pad-btn" onClick={save}><span>Сохранить</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AdminPermsAptGroup ───────────────────────────────────────────────────────

function AdminPermsAptGroup({ u, tab }: AdminPermsAptGroupProps) {
  const isWorker = tab === 'workers';
  const [adding, setAdding] = useState(false);
  const [form,   setForm]   = useState({ name: '', phone: '', carPlate: '' });
  const perms = usePerms(u.uid);
  const { setPerms } = useActions();
  const list = perms[tab] || EMPTY_PERMS[tab];

  // FIX [LEAK]: isMountedRef — AdminPermsAptGroup может размонтироваться при смене вкладки
  const grpMountedRef = useRef(true);
  useEffect(() => { grpMountedRef.current = true; return () => { grpMountedRef.current = false; }; }, []);

  async function addItem() {
    if (!form.name.trim()) { toast('Введите ФИО', 'error'); return; }
    const updated = { ...perms, [tab]: [...list, { id: genId('p'), ...form, name: form.name.trim() }] };
    let mode: Awaited<ReturnType<typeof services.admin.savePermsEverywhere>>;
    try {
      mode = await services.admin.savePermsEverywhere({ uid: u.uid, perms: updated, saveLocal: setPerms });
    } catch {
      if (grpMountedRef.current) toast('Ошибка сохранения', 'error');
      return;
    }
    if (!grpMountedRef.current) return;
    setForm({ name: '', phone: '', carPlate: '' });
    setAdding(false);
    toastBySyncResult(mode, 'Запись добавлена', 'Запись сохранена локально. Синхронизация будет повторена позже');
  }

  async function delItem(id: string) {
    const updated = { ...perms, [tab]: list.filter((x: PermEntry) => x.id !== id) };
    let mode: Awaited<ReturnType<typeof services.admin.savePermsEverywhere>>;
    try {
      mode = await services.admin.savePermsEverywhere({ uid: u.uid, perms: updated, saveLocal: setPerms });
    } catch {
      if (grpMountedRef.current) toast('Ошибка сохранения', 'error');
      return;
    }
    if (!grpMountedRef.current) return;
    toastBySyncResult(mode, 'Запись удалена', 'Изменения сохранены локально. Синхронизация будет повторена позже');
  }

  async function clearAll() {
    const updated = { ...perms, [tab]: [] };
    let mode: Awaited<ReturnType<typeof services.admin.savePermsEverywhere>>;
    try {
      mode = await services.admin.savePermsEverywhere({ uid: u.uid, perms: updated, saveLocal: setPerms });
    } catch {
      if (grpMountedRef.current) toast('Ошибка сохранения', 'error');
      return;
    }
    if (!grpMountedRef.current) return;
    toastBySyncResult(mode, 'Список очищен', 'Изменения сохранены локально. Синхронизация будет повторена позже');
  }

  function handleCancelAdd() {
    setAdding(false);
    setForm({ name: '', phone: '', carPlate: '' });
  }

  return (
    <div className="sec-apt-group">
      <div className="sec-apt-hdr admin-perm-group-hdr u-row-between">
        <span className="admin-perm-group-title">
          Апарт. {u.apartment} — {u.name}
          <span className="admin-perm-role-label"> ({ROLE_LABELS[u.role]})</span>
        </span>
        <div className="u-row-g6 admin-perm-group-actions">
          <span className="u-fs11-t4 admin-perm-group-count">{list.length} зап.</span>
          {list.length > 0 && (
            <button className="btn-del-sm admin-perm-clear-btn" onClick={clearAll}>Очистить</button>
          )}
        </div>
      </div>

      {list.map(item => (
        <AdminPermsItemRow
          key={item.id} uid={u.uid} listKey={tab} item={item}
          onDel={() => delItem(item.id)}
        />
      ))}

      {adding ? (
        <div className="perm-form">
          <div className="perm-form-row">
            <input className="perm-form-inp" placeholder="ФИО *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoCapitalize="words" />
            <input className="perm-form-inp" placeholder="Телефон" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          </div>
          {isWorker && (
            <div className="perm-form-row">
              <input className="perm-form-inp" placeholder="Авто (марка, номер)" value={form.carPlate} onChange={e => setForm({ ...form, carPlate: e.target.value })} autoCapitalize="characters" />
            </div>
          )}
          <div className="perm-form-btns">
            <button className="btn-outline" onClick={handleCancelAdd}>Отмена</button>
            <button className="btn-gold u-pad-btn" onClick={addItem}><span>Добавить</span></button>
          </div>
        </div>
      ) : (
        <button className="perm-add" onClick={() => setAdding(true)}>
          ＋ Добавить {isWorker ? 'рабочего' : 'посетителя'}
        </button>
      )}
    </div>
  );
}

// ─── AdminPermsView ───────────────────────────────────────────────────────────

export default function AdminPermsView() {
  const [tab,   setTab]   = useState<PermListKey>('visitors');
  const [query, setQuery] = useState('');
  const { users }  = useUsers();
  const perms = useAllPerms();
  const debouncedQuery = useDebounce(query, 250);
  const q = debouncedQuery.trim().toLowerCase();
  const [roleFilter, setRoleFilter] = useState<(typeof ROLE_FILTERS)[number][0]>('all');
  const permsEmptyCopy = getViewStateCopy('admin_perms', 'empty');

  const allResidents = useMemo(() =>
    Object.values(users)
      .filter(u => u.role === 'owner' || u.role === 'tenant' || u.role === 'contractor')
      .sort((a, b) => {
        const aNum = parseInt(a.apartment ?? '', 10);
        const bNum = parseInt(b.apartment ?? '', 10);
        const aHas = !isNaN(aNum);
        const bHas = !isNaN(bNum);
        if (aHas && bHas) return aNum - bNum;
        if (aHas) return -1;
        if (bHas) return 1;
        return a.name.localeCompare(b.name, 'ru');
      }),
    [users]);

  const residents = useMemo(() =>
    roleFilter === 'all' ? allResidents : allResidents.filter(u => u.role === roleFilter),
    [allResidents, roleFilter]);

  const matchRes  = (u: AppUser) => !q || (u.apartment ?? '').toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
  const matchItem = (item: PermEntry) => !q
    || item.name.toLowerCase().includes(q)
    || (item.phone || '').includes(q)
    || (item.carPlate || '').toLowerCase().includes(q);

  const visCount = useMemo(() => residents.reduce((a, u) => (perms[u.uid] || EMPTY_PERMS).visitors.length + a, 0), [residents, perms]);
  const wrkCount = useMemo(() => residents.reduce((a, u) => (perms[u.uid] || EMPTY_PERMS).workers.length  + a, 0), [residents, perms]);

  const filtered = useMemo(() => residents.filter((u: AppUser) => {
    if (!q) return true;
    const p = perms[u.uid] || EMPTY_PERMS;
    return matchRes(u) || (p[tab] || []).some(matchItem);
  }), [residents, q, tab, perms]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="tabs u-mb10">
        <button className={'tab-btn ' + (tab === 'visitors' ? 'active' : '')} onClick={() => setTab('visitors')}>
          <AppIcon name="users" className="u-inline-icon" /> Посетители ({visCount})
        </button>
        <button className={'tab-btn ' + (tab === 'workers' ? 'active' : '')} onClick={() => setTab('workers')}>
          <AppIcon name="tools" className="u-inline-icon" /> Рабочие ({wrkCount})
        </button>
      </div>
      <div className="date-pills u-mb10">
        {ROLE_FILTERS.map(([k, l]) => (
          <button key={k} className={'date-pill ' + (roleFilter === k ? 'active' : '')} onClick={() => setRoleFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" /></span>
        <input className="search-inp" placeholder="Поиск по апарт., ФИО, телефону..."
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {filtered.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : permsEmptyCopy.title}
          subtitle={q ? 'Попробуйте другой запрос' : permsEmptyCopy.subtitle}
        />
      )}
      {filtered.map(u => <AdminPermsAptGroup key={u.uid + tab} u={u} tab={tab} />)}
    </div>
  );
}
