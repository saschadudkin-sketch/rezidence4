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
 * ResidentsView вЂ” СЃРїСЂР°РІРѕС‡РЅРёРє Р¶РёР»СЊС†РѕРІ РґР»СЏ РѕС…СЂР°РЅС‹ Рё РєРѕРЅСЃСЊРµСЂР¶Р°.
 * РџРѕРєР°Р·С‹РІР°РµС‚: Р°РїР°СЂС‚Р°РјРµРЅС‚, Р¶РёР»СЊС†С‹, РёС… РјР°С€РёРЅС‹, РїР°СЂРєРѕРІРѕС‡РЅС‹Рµ РјРµСЃС‚Р°,
 * РїРѕСЃС‚РѕСЏРЅРЅС‹Рµ РїРѕСЃРµС‚РёС‚РµР»Рё Рё СЂР°Р±РѕС‡РёРµ (РёР· perms).
 */
type ResidentPerm = { id?: string; name: string; phone?: string; carPlate?: string };
type ResidentWithApartment = AppUser & { apartment: string };

const hasKnownApartment = (user: AppUser): user is ResidentWithApartment =>
  isResident(user.role) && typeof user.apartment === 'string' && user.apartment !== 'вЂ”';

export default function ResidentsView({ user }: { user: AppUser }) {
  const { users } = useUsers();
  const garage = useAllGarage();
  const allPerms = useAllPerms();
  const [query, setQuery] = useState('');
  const dq = useDebounce(query, 200);
  const [expandedApt, setExpandedApt] = useState<string | null>(null);
  const emptyCopy = getViewStateCopy('residents', 'empty');

  // Р“СЂСѓРїРїРёСЂСѓРµРј Р¶РёР»СЊС†РѕРІ РїРѕ Р°РїР°СЂС‚Р°РјРµРЅС‚Р°Рј
  const aptGroups = useMemo(() => {
    const residents = Object.values(users).filter(hasKnownApartment);
    const byApt: Record<string, ResidentWithApartment[]> = {};
    residents.forEach((resident) => {
      const { apartment } = resident;
      if (!byApt[apartment]) byApt[apartment] = [];
      byApt[apartment].push(resident);
    });

    // РЎРѕСЂС‚РёСЂСѓРµРј Р°РїР°СЂС‚Р°РјРµРЅС‚С‹ С‡РёСЃР»РѕРІРѕ
    return Object.entries(byApt).sort(([a], [b]) => {
      const na = parseInt(a, 10) || 0;
      const nb = parseInt(b, 10) || 0;
      return na - nb || a.localeCompare(b);
    });
  }, [users]);

  // FIX [PERF]: getCars РјРµРјРѕРёР·РёСЂРѕРІР°РЅ С‡РµСЂРµР· useCallback вЂ” РЅРµ РїРµСЂРµСЃРѕР·РґР°С‘С‚СЃСЏ РїСЂРё СЂРµ-СЂРµРЅРґРµСЂРµ
  // garage СѓР¶Рµ РјРµРјРѕРёР·РёСЂРѕРІР°РЅ РІ AppStore, РїРѕСЌС‚РѕРјСѓ deps СЃС‚Р°Р±РёР»РµРЅ
  const getCars = useCallback((uid: string): Car[] => (garage && garage[uid]) || [], [garage]);

  // РџРѕСЃС‚РѕСЏРЅРЅС‹Рµ РїРѕСЃРµС‚РёС‚РµР»Рё Рё СЂР°Р±РѕС‡РёРµ Р¶РёР»СЊС†Р°
  const getPermsForUser = useCallback((uid: string): { visitors: ResidentPerm[]; workers: ResidentPerm[] } => {
    const value = allPerms[uid];
    if (value && typeof value === 'object' && 'visitors' in value && 'workers' in value) {
      return value as { visitors: ResidentPerm[]; workers: ResidentPerm[] };
    }
    return { visitors: [], workers: [] };
  }, [allPerms]);

  // Р’СЃРµ РґР°РЅРЅС‹Рµ РїР»РѕСЃРєРёРј СЃРїРёСЃРєРѕРј РґР»СЏ РїРѕРёСЃРєР°
  const filtered = useMemo(() => {
    if (!dq.trim()) return aptGroups;
    const q = dq.toLowerCase();
    return aptGroups.filter(([apt, residents]) => {
      if (apt.toLowerCase().includes(q)) return true;
      if (residents.some((resident) => resident.name.toLowerCase().includes(q) || resident.phone.includes(q))) return true;
      if (residents.some((resident) => (resident.parkingSpot || '').toLowerCase().includes(q))) return true;
      if (residents.some((resident) => getCars(resident.uid).some((car) => car.plate.toLowerCase().includes(q)))) return true;
      return false;
    });
  }, [aptGroups, dq, getCars]);

  const totalResidents = useMemo(
    () => filtered.reduce((count, [, residents]) => count + residents.length, 0),
    [filtered],
  );

  return (
    <div className="residents-view">
      <div className="search-wrap residents-search-wrap">
        <span className="search-icon"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          placeholder="РђРїР°СЂС‚., РёРјСЏ, Р°РІС‚Рѕ, РїР°СЂРєРѕРІРєР°..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="РћС‡РёСЃС‚РёС‚СЊ РїРѕРёСЃРє">
            <AppIcon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="residents-summary">
        <span>{filtered.length} Р°РїР°СЂС‚Р°РјРµРЅС‚РѕРІ</span>
        <span>{totalResidents} Р¶РёР»СЊС†РѕРІ</span>
      </div>

      {filtered.length === 0 && (
        <StateBlock type="empty" title={emptyCopy.title} subtitle={emptyCopy.subtitle} />
      )}

      <div className="apt-list">
        {filtered.map(([apt, residents]) => {
          const isOpen = expandedApt === apt;
          const allCars = residents.flatMap((resident) => getCars(resident.uid));
          const parkingSpots = [...new Set(residents.map((resident) => resident.parkingSpot).filter(Boolean))];

          return (
            <div key={apt} className={'apt-card' + (isOpen ? ' open' : '')}>
              <button
                type="button"
                className="apt-header"
                aria-expanded={isOpen}
                aria-label={'РђРїР°СЂС‚Р°РјРµРЅС‚С‹ ' + apt}
                onClick={() => setExpandedApt(isOpen ? null : apt)}
              >
                <div className="apt-num">
                  <span className="apt-num-ico"><AppIcon name="residents" size={14} /></span>
                  <span className="apt-num-val">РђРїР°СЂС‚. {apt}</span>
                </div>
                <div className="apt-meta">
                  <span className="apt-chip">{residents.length} Р¶РёР».</span>
                  {allCars.length > 0 && <span className="apt-chip car"><AppIcon name="car" size={12} /> {allCars.length}</span>}
                  {parkingSpots.length > 0 && <span className="apt-chip park">рџ…ї {parkingSpots.join(', ')}</span>}
                </div>
                <span className="apt-chevron">{isOpen ? 'в–І' : 'в–ј'}</span>
              </button>

              {isOpen && (
                <div className="apt-body">
                  {residents.map((resident) => {
                    const cars = getCars(resident.uid);
                    const userPerms = getPermsForUser(resident.uid);
                    const visitors = userPerms.visitors || [];
                    const workers = userPerms.workers || [];

                    return (
                      <div key={resident.uid} className="resident-row">
                        <AvatarCircle avData={null} role={resident.role} name={resident.name} size={34} fontSize={13} />
                        <div className="resident-info">
                          <div className="resident-name">{resident.name}</div>
                          <div className="resident-meta">
                            <a href={'tel:' + resident.phone.replace(/\s/g, '')} className="resident-phone">
                              {resident.phone}
                            </a>
                            {resident.parkingSpot && (
                              <span className="resident-parking">рџ…ї {resident.parkingSpot}</span>
                            )}
                          </div>
                          {cars.length > 0 && (
                            <div className="resident-cars">
                              {cars.map((car) => (
                                <div key={car.id} className={'car-tag' + (car.isMain ? ' main' : '')}>
                                  <span className="car-plate">{car.plate}</span>
                                  {car.brand && <span className="car-brand">{car.brand}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {visitors.length > 0 && (
                            <div className="perm-section">
                              <SectionHeader title="РџРѕСЃС‚РѕСЏРЅРЅС‹Рµ РїРѕСЃРµС‚РёС‚РµР»Рё" className="section-header--compact" />
                              {visitors.map((visitor, index) => (
                                <div key={visitor.id || index} className="perm-entry">
                                  <span className="perm-name">{visitor.name}</span>
                                  {visitor.phone && (
                                    <a href={'tel:' + visitor.phone.replace(/\s/g, '')} className="perm-phone">
                                      {visitor.phone}
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {workers.length > 0 && (
                            <div className="perm-section">
                              <SectionHeader title="РџРѕСЃС‚РѕСЏРЅРЅС‹Рµ СЂР°Р±РѕС‡РёРµ" className="section-header--compact" />
                              {workers.map((worker, index) => (
                                <div key={worker.id || index} className="perm-entry">
                                  <span className="perm-name">{worker.name}</span>
                                  {worker.phone && (
                                    <a href={'tel:' + worker.phone.replace(/\s/g, '')} className="perm-phone">
                                      {worker.phone}
                                    </a>
                                  )}
                                  {worker.carPlate && <span className="perm-car"><AppIcon name="car" size={12} /> {worker.carPlate}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {user.role === ROLES.ADMIN && (
                            <div className="perm-section">
                              <GarageView user={user} targetUid={resident.uid} />
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
