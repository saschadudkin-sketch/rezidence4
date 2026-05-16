import { useRef, useState } from 'react';
import { useAppStoreSelector } from '../store/AppStore';
import { useDebounce } from '../hooks/useDebounce';
import { AvatarCircle } from '../ui/AvatarCircle';
import { AppIcon } from '../ui/AppIcon';
import { ROLES } from '../domain/permissions';
import GarageView from './GarageView';
import SectionHeader from '../ui/SectionHeader';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import { makeSelectResidentsDirectory } from '../store/selectors/requestsSelectors';
import type { ResidentDirectoryResident } from '../store/selectors/requestsSelectors';
import type { AppUser } from '../store/slices/usersSlice';

/**
 * ResidentsView — справочник жильцов для охраны и консьержа.
 * Показывает: апартамент, жильцов, их машины, парковочные места,
 * постоянных посетителей и рабочих (из perms).
 */
type ResidentsViewProps = {
  user: AppUser;
  onCreatePass?: (resident: ResidentDirectoryResident) => void;
};

export default function ResidentsView({ user, onCreatePass }: ResidentsViewProps) {
  const [query, setQuery] = useState('');
  const dq = useDebounce(query, 200);
  const [expandedApt, setExpandedApt] = useState<string | null>(null);
  const residentsDirectorySelectorRef = useRef(makeSelectResidentsDirectory());
  const emptyCopy = getViewStateCopy('residents', 'empty');
  const { filtered, totalResidents } = useAppStoreSelector((state) => residentsDirectorySelectorRef.current(state, dq));

  return (
    <div className="residents-view">
      <div className="search-wrap residents-search-wrap">
        <span className="search-icon"><AppIcon name="search" size={14} /></span>
        <input
          className="search-inp"
          placeholder="Апарт., имя, авто, парковка..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск">
            <AppIcon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="residents-summary">
        <span>{filtered.length} апартаментов</span>
        <span>{totalResidents} жильцов</span>
      </div>

      {filtered.length === 0 && (
        <StateBlock type="empty" title={emptyCopy.title} subtitle={emptyCopy.subtitle} />
      )}

      <div className="apt-list">
        {filtered.map((group) => {
          const { apartment, residents, cars: allCars, parkingSpots } = group;
          const isOpen = expandedApt === apartment;

          return (
            <div key={apartment} className={'apt-card' + (isOpen ? ' open' : '')}>
              <button
                type="button"
                className="apt-header"
                aria-expanded={isOpen}
                aria-label={'Апартаменты ' + apartment}
                onClick={() => setExpandedApt(isOpen ? null : apartment)}
              >
                <div className="apt-num">
                  <span className="apt-num-ico"><AppIcon name="residents" size={14} /></span>
                  <span className="apt-num-val">Апарт. {apartment}</span>
                </div>
                <div className="apt-meta">
                  <span className="apt-chip">{residents.length} жил.</span>
                  {allCars.length > 0 && <span className="apt-chip car"><AppIcon name="car" size={12} /> {allCars.length}</span>}
                  {parkingSpots.length > 0 && <span className="apt-chip park">P {parkingSpots.join(', ')}</span>}
                </div>
                <span className="apt-chevron">{isOpen ? '▴' : '▾'}</span>
              </button>

              {isOpen && (
                <div className="apt-body">
                  {residents.map((resident) => {
                    const cars = resident.cars;
                    const visitors = resident.perms.visitors || [];
                    const workers = resident.perms.workers || [];

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
                              <span className="resident-parking">P {resident.parkingSpot}</span>
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
                          <div className="resident-actions">
                            <a href={'tel:' + resident.phone.replace(/\s/g, '')} className="resident-action resident-action--secondary">
                              <AppIcon name="phone" size={12} />
                              <span>Позвонить</span>
                            </a>
                            {onCreatePass && (
                              <button type="button" className="resident-action resident-action--primary" onClick={() => onCreatePass(resident)}>
                                <AppIcon name="ticket" size={12} />
                                <span>Оформить пропуск</span>
                              </button>
                            )}
                          </div>
                          {visitors.length > 0 && (
                            <div className="perm-section">
                              <SectionHeader title="Постоянные посетители" className="section-header--compact" />
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
                              <SectionHeader title="Постоянные рабочие" className="section-header--compact" />
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
