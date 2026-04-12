import { useState, useMemo, useCallback } from 'react';
import { useUsers, useAllGarage, useAllPerms } from '../store/AppStore';
import { useDebounce } from '../hooks/useDebounce';
import { AvatarCircle } from '../ui/AvatarCircle';
import { AppIcon } from '../ui/AppIcon';
import { isResident, ROLES } from '../domain/permissions';
import GarageView from './GarageView';
import SectionHeader from '../ui/SectionHeader';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import type { AppUser } from '../store/slices/usersSlice';
import type { Car } from '../store/slices/garageSlice';

/**
 * ResidentsView — справочник жильцов для охраны и консьержа.
 * Показывает: апартамент, жильцы, их машины, парковочные места,
 * постоянные посетители и рабочие (из perms).
 */
type ResidentPerm = { id?: string; name: string; phone?: string; carPlate?: string };

export default function ResidentsView({ user }: { user: AppUser }) {
  const { users }    = useUsers();
  const garage = useAllGarage();
  const allPerms = useAllPerms();
  const [query, setQuery] = useState('');
  const dq = useDebounce(query, 200);
  const [expandedApt, setExpandedApt] = useState(null);
  const emptyCopy = getViewStateCopy('residents', 'empty');

  // Группируем жильцов по апартаментам
  const aptGroups = useMemo(() => {
    const residents = Object.values(users).filter(u => isResident(u.role) && u.apartment && u.apartment !== '—');
    const byApt: Record<string, AppUser[]> = {};
    residents.forEach(u => {
      if (!byApt[u.apartment]) byApt[u.apartment] = [];
      byApt[u.apartment].push(u);
    });
    // Сортируем апартаменты числово
    return Object.entries(byApt).sort(([a], [b]) => {
      const na = parseInt(a) || 0, nb = parseInt(b) || 0;
      return na - nb || a.localeCompare(b);
    });
  }, [users]);

  // FIX [PERF]: getCars мемоизирован через useCallback — не пересоздаётся при ре-рендере
  // garage уже мемоизирован в AppStore, поэтому deps стабилен
  const getCars = useCallback((uid: string): Car[] => (garage && garage[uid]) || [], [garage]);
  // Постоянные посетители и рабочие жильца
  const getPermsForUser = useCallback((uid: string): { visitors: ResidentPerm[]; workers: ResidentPerm[] } => {
    const value = allPerms[uid];
    if (value && typeof value === 'object' && 'visitors' in value && 'workers' in value) {
      return value as { visitors: ResidentPerm[]; workers: ResidentPerm[] };
    }
    return { visitors: [], workers: [] };
  }, [allPerms]);

  // Все данные плоским списком для поиска
  const filtered = useMemo(() => {
    if (!dq.trim()) return aptGroups;
    const q = dq.toLowerCase();
    return aptGroups.filter(([apt, residents]) => {
      if (apt.toLowerCase().includes(q)) return true;
      if (residents.some(u => u.name.toLowerCase().includes(q) || (u.phone || '').includes(q))) return true;
      if (residents.some(u => (u.parkingSpot || '').toLowerCase().includes(q))) return true;
      // Поиск по номеру авто
      if (residents.some(u => getCars(u.uid).some(c => c.plate.toLowerCase().includes(q)))) return true;
      return false;
    });
  }, [aptGroups, dq, getCars]);

  return (
    <div className="residents-view">
      {/* Поиск */}
      <div className="search-wrap residents-search-wrap">
        <span className="search-icon"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          placeholder="Апарт., имя, авто, парковка..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск">
            <AppIcon name="close" size={14} />
          </button>
        )}
      </div>

      {/* Итог */}
      {/* FIX [PERF]: totalResidents вынесен из JSX — reduce не запускается в render */}
      {(() => {
        const totalResidents = filtered.reduce((n, [, r]) => n + r.length, 0);
        return (
          <div className="residents-summary">
            <span>{filtered.length} апартаментов</span>
            <span>{totalResidents} жильцов</span>
          </div>
        );
      })()}

      {/* Список апартаментов */}
      {filtered.length === 0 && (
        <StateBlock type="empty" title={emptyCopy.title} subtitle={emptyCopy.subtitle} />
      )}

      <div className="apt-list">
      {filtered.map(([apt, residents]) => {
          const isOpen = expandedApt === apt;
          // Все машины апартамента
          const allCars = residents.flatMap(u => getCars(u.uid));
          // Парковочные места
          const parkingSpots = [...new Set(residents.map(u => u.parkingSpot).filter(Boolean))];

          return (
            <div key={apt} className={'apt-card' + (isOpen ? ' open' : '')}>
              {/* Заголовок апартамента */}
              <button type="button" className="apt-header"
                aria-expanded={isOpen} aria-label={'Апартаменты ' + apt}
                onClick={() => setExpandedApt(isOpen ? null : apt)}>
                <div className="apt-num">
                  <span className="apt-num-ico"><AppIcon name="residents" size={14} /></span>
                  <span className="apt-num-val">Апарт. {apt}</span>
                </div>
                <div className="apt-meta">
                  <span className="apt-chip">{residents.length} жил.</span>
                  {allCars.length > 0 && <span className="apt-chip car"><AppIcon name="car" size={12} /> {allCars.length}</span>}
                  {parkingSpots.length > 0 && <span className="apt-chip park">🅿 {parkingSpots.join(', ')}</span>}
                </div>
                <span className="apt-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Раскрытая карточка */}
              {isOpen && (
                <div className="apt-body">
                  {residents.map(u => {
                    const cars = getCars(u.uid);
                    const userPerms = getPermsForUser(u.uid);
                    const visitors = userPerms.visitors || [];
                    const workers = userPerms.workers || [];
                    return (
                      <div key={u.uid} className="resident-row">
                        <AvatarCircle avData={null} role={u.role} name={u.name} size={34} fontSize={13} />
                        <div className="resident-info">
                          <div className="resident-name">{u.name}</div>
                          <div className="resident-meta">
                            <a href={'tel:' + u.phone.replace(/\s/g, '')} className="resident-phone">
                              {u.phone}
                            </a>
                            {u.parkingSpot && (
                              <span className="resident-parking">🅿 {u.parkingSpot}</span>
                            )}
                          </div>
                          {/* Машины жильца */}
                          {cars.length > 0 && (
                            <div className="resident-cars">
                              {cars.map(car => (
                                <div key={car.id} className={'car-tag' + (car.isMain ? ' main' : '')}>
                                  <span className="car-plate">{car.plate}</span>
                                  {car.brand && <span className="car-brand">{car.brand}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Постоянные посетители */}
                          {visitors.length > 0 && (
                            <div className="perm-section">
                              <SectionHeader title="Постоянные посетители" className="section-header--compact" />
                              {visitors.map((v, i) => (
                                <div key={v.id || i} className="perm-entry">
                                  <span className="perm-name">{v.name}</span>
                                  {v.phone && (
                                    <a href={'tel:' + v.phone.replace(/\s/g, '')} className="perm-phone">
                                      {v.phone}
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Постоянные рабочие */}
                          {workers.length > 0 && (
                            <div className="perm-section">
                              <SectionHeader title="Постоянные рабочие" className="section-header--compact" />
                              {workers.map((w, i) => (
                                <div key={w.id || i} className="perm-entry">
                                  <span className="perm-name">{w.name}</span>
                                  {w.phone && (
                                    <a href={'tel:' + w.phone.replace(/\s/g, '')} className="perm-phone">
                                      {w.phone}
                                    </a>
                                  )}
                                  {w.carPlate && <span className="perm-car"><AppIcon name="car" size={12} /> {w.carPlate}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Admin: редактирование машин жильца */}
                          {user.role === ROLES.ADMIN && (
                            <div className="perm-section">
                              <GarageView user={user} targetUid={u.uid} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
