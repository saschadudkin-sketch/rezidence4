import { useState, useMemo, useCallback } from 'react';
import { useUsers, useAllGarage, useAllPerms } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce.js';
import { AvatarCircle } from '../ui/AvatarCircle.jsx';
import { isResident, ROLES } from '../domain/permissions.js';
import GarageView from './GarageView.jsx';

/**
 * ResidentsView — справочник жильцов для охраны и консьержа.
 * Показывает: апартамент, жильцы, их машины, парковочные места,
 * постоянные посетители и рабочие (из perms).
 */
export default function ResidentsView({ user }) {
  const { users }    = useUsers();
  const garage = useAllGarage();
  const allPerms = useAllPerms();
  const [query, setQuery] = useState('');
  const dq = useDebounce(query, 200);
  const [expandedApt, setExpandedApt] = useState(null);

  // Группируем жильцов по апартаментам
  const aptGroups = useMemo(() => {
    const residents = Object.values(users).filter(u => isResident(u.role) && u.apartment && u.apartment !== '—');
    const byApt = {};
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
  const getCars = useCallback((uid) => (garage && garage[uid]) || [], [garage]);
  // Постоянные посетители и рабочие жильца
  const getPermsForUser = useCallback((uid) => allPerms[uid] || { visitors: [], workers: [] }, [allPerms]);

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
      <div className="search-wrap" style={{ marginBottom: 12 }}>
        <span className="search-icon">🔍</span>
        <input
          className="search-inp"
          placeholder="Апарт., имя, авто, парковка..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
        />
        {query && <button className="search-clear" onClick={() => setQuery('')}>✕</button>}
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
        <div className="empty-state">
          <div className="empty-icon">🏠</div>
          <div className="empty-title">Ничего не найдено</div>
          <div className="empty-sub">Попробуйте другой запрос</div>
        </div>
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
              <div className="apt-header" role="button" tabIndex={0}
                aria-expanded={isOpen} aria-label={'Апартаменты ' + apt}
                onClick={() => setExpandedApt(isOpen ? null : apt)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setExpandedApt(isOpen ? null : apt))}>
                <div className="apt-num">
                  <span className="apt-num-ico">🏠</span>
                  <span className="apt-num-val">Апарт. {apt}</span>
                </div>
                <div className="apt-meta">
                  <span className="apt-chip">{residents.length} жил.</span>
                  {allCars.length > 0 && <span className="apt-chip car">🚗 {allCars.length}</span>}
                  {parkingSpots.length > 0 && <span className="apt-chip park">🅿 {parkingSpots.join(', ')}</span>}
                </div>
                <span className="apt-chevron">{isOpen ? '▲' : '▼'}</span>
              </div>

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
                              📞 {u.phone}
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
                              <div className="perm-section-title">👤 Постоянные посетители</div>
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
                              <div className="perm-section-title">🔧 Постоянные рабочие</div>
                              {workers.map((w, i) => (
                                <div key={w.id || i} className="perm-entry">
                                  <span className="perm-name">{w.name}</span>
                                  {w.phone && (
                                    <a href={'tel:' + w.phone.replace(/\s/g, '')} className="perm-phone">
                                      {w.phone}
                                    </a>
                                  )}
                                  {w.carPlate && <span className="perm-car">🚗 {w.carPlate}</span>}
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
