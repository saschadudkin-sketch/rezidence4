import { memo, useMemo, useState } from 'react';
import { useUsers, useAllPerms } from '../../store/AppStore';
import { useDebounce } from '../../hooks/useDebounce';
import { ROLE_LABELS } from '../../constants/index';
import { AvatarCircle } from '../../ui/AvatarCircle';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import { getViewStateCopy } from '../../ui/viewStateContract';
import type { AppUser } from '../../store/slices/usersSlice';
import type { PermEntry, UserPerms } from '../../store/slices/permsSlice';

type SecurityPermTab = 'visitors' | 'workers';
type ResidentPermBucket = {
  u: AppUser & { apartment: string };
  list: PermEntry[];
};

export const SecurityPermsList = memo(function SecurityPermsList() {
  const [tab, setTab] = useState<SecurityPermTab>('visitors');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [openApts, setOpenApts] = useState<Record<string, boolean>>({});
  const { users } = useUsers();
  const perms = useAllPerms() as Record<string, UserPerms>;

  const handleSetTab = (newTab: SecurityPermTab) => {
    setTab(newTab);
    setOpenApts({});
  };

  const residents = useMemo(
    () =>
      Object.values(users)
        .filter((user): user is AppUser & { apartment: string } => Boolean(user.apartment && user.apartment !== '—'))
        .sort((left, right) => Number(left.apartment) - Number(right.apartment)),
    [users],
  );

  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const permsEmptyCopy = getViewStateCopy('security_perms', 'empty');

  const residentItems = useMemo<ResidentPermBucket[]>(() => {
    const matchResident = (user: AppUser & { apartment: string }) =>
      !normalizedQuery
      || user.apartment.toLowerCase().includes(normalizedQuery)
      || user.name.toLowerCase().includes(normalizedQuery);

    const matchItem = (item: PermEntry) =>
      !normalizedQuery
      || item.name.toLowerCase().includes(normalizedQuery)
      || item.phone.includes(normalizedQuery);

    return residents
      .map((user) => {
        const residentPerms = perms[user.uid] || { visitors: [], workers: [] };
        const allItems = tab === 'visitors' ? residentPerms.visitors : residentPerms.workers;
        const list = normalizedQuery ? allItems.filter((item) => matchResident(user) || matchItem(item)) : allItems;
        return { u: user, list };
      })
      .filter(({ list }) => list.length > 0);
  }, [residents, perms, tab, normalizedQuery]);

  const toggleApt = (uid: string) => {
    setOpenApts((current) => ({ ...current, [uid]: !current[uid] }));
  };

  return (
    <div>
      <div className="tabs u-mb10">
        <button className={`tab-btn ${tab === 'visitors' ? 'active' : ''}`} onClick={() => handleSetTab('visitors')}>Посетители</button>
        <button className={`tab-btn ${tab === 'workers' ? 'active' : ''}`} onClick={() => handleSetTab('workers')}>Рабочие</button>
      </div>
      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          aria-label="Поиск жителей"
          placeholder="Поиск по апартаменту или ФИО..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {residentItems.length === 0 && (
        <StateBlock
          type="empty"
          title={normalizedQuery ? 'Ничего не найдено' : permsEmptyCopy.title}
          subtitle={normalizedQuery ? 'Попробуйте другой запрос' : permsEmptyCopy.subtitle}
        />
      )}
      {residentItems.map(({ u, list }) => {
        const isOpen = openApts[u.uid] === true;
        return (
          <div key={u.uid} className="u-mb8">
            <button type="button" className={`spl-apt-row${isOpen ? ' open' : ''}`} aria-expanded={isOpen} onClick={() => toggleApt(u.uid)}>
              <div className="spl-apt-info">
                <AvatarCircle avData={null} role={u.role} name={u.name} size={32} fontSize={13} />
                <div>
                  <div className="spl-apt-title">{`Апарт. ${u.apartment}`}</div>
                  <div className="spl-apt-sub">{u.name} · <span className="u-t4">{ROLE_LABELS[u.role]}</span></div>
                </div>
              </div>
              <div className="spl-apt-right">
                <span className="spl-count">{list.length}</span>
                <span className={`spl-arrow${isOpen ? ' open' : ''}`}>▾</span>
              </div>
            </button>
            {isOpen && (
              <div className="spl-items">
                {list.map((item) => (
                  <div key={item.id} className="spl-item">
                    <div className="perm-info">
                      <div className="perm-name">{item.name}</div>
                      <div className="perm-meta">{[item.phone, item.carPlate].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
