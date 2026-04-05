import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUsers, useAllGarage } from '../store/AppStore';
import { isResident } from '../domain/permissions';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';

/**
 * CarSearchModal — быстрый поиск авто по номеру.
 * Охрана вводит номер → видит апартамент, жильца, место паркинга.
 */
export function CarSearchModal({ onClose }) {
  const { users }   = useUsers();
  const garage = useAllGarage();
  const [query, setQuery] = useState('');
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const found = [];
    Object.values(users).forEach(u => {
      if (!isResident(u.role)) return;
      const cars = (garage && garage[u.uid]) || [];
      cars.forEach(car => {
        if (car.plate.toLowerCase().includes(q)) {
          found.push({ user: u, car });
        }
      });
    });
    return found;
  }, [query, users, garage]);

  return createPortal(
    <div className="overlay" {...overlayProps}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <span className="modal-title"><AppIcon name="car" size={16} /> Поиск по номеру авто</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-lbl">Номер автомобиля</label>
            <input
              className="field-inp"
              placeholder="А 000 АА 000 или часть номера"
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              autoFocus
              autoComplete="off"
            />
          </div>

          {query.trim().length >= 2 && results.length === 0 && (
            <div className="car-search-empty">
              <div className="car-search-empty-icon"><AppIcon name="search" size={30} /></div>
              <div className="car-search-empty-title">Автомобиль не найден</div>
              <div className="car-search-empty-sub">
                Машина не добавлена в систему жильцом
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="car-search-results">
              {results.map(({ user: u, car }) => (
                <div key={car.id} className="car-search-card">
                  <div className="car-search-plate">{car.plate}</div>
                  <div className="car-search-info">
                    {car.brand && <div className="car-search-brand">{car.brand}</div>}
                    <div className="car-search-resident">
                      <span className="car-search-apt">Апарт. {u.apartment}</span>
                      <span className="car-search-name">{u.name}</span>
                    </div>
                    {u.parkingSpot && (
                      <div className="car-search-parking">🅿 Парковка: <strong>{u.parkingSpot}</strong></div>
                    )}
                    <a href={'tel:' + u.phone.replace(/\s/g, '')} className="car-search-phone">
                      {u.phone}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {query.trim().length < 2 && (
            <div className="car-search-hint">
              Введите минимум 2 символа для поиска
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-outline u-flex1" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
