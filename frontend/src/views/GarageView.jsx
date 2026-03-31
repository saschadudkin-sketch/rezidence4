import { useState, useCallback } from 'react';
import { useGarage, useActions } from '../store/AppStore';
import { genId } from '../utils.js';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';

/**
 * GarageView — управление машинами квартиры
 * targetUid — uid жильца чей гараж редактируем (для админа). По умолчанию = user.uid.
 */
export default function GarageView({ user, targetUid }) {
  const uid = targetUid || user.uid;
  const cars    = useGarage(uid);
  const { addGarageCar, updateGarageCar, deleteGarageCar } = useActions();

  const [adding,   setAdding]   = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [plate,    setPlate]    = useState('');
  const [brand,    setBrand]    = useState('');
  const [note,     setNote]     = useState('');
  const [isMain,   setIsMain]   = useState(false);

  // FIX [PERF]: useCallback — не пересоздаётся при каждом рендере
  const resetForm = useCallback(() => { setPlate(''); setBrand(''); setNote(''); setIsMain(false); setAdding(false); setEditId(null); }, []);

  const save = () => {
    const trimPlate = plate.trim().toUpperCase();
    if (!trimPlate) { toast('Введите номер автомобиля', 'error'); return; }
    if (cars.some(c => c.plate === trimPlate && c.id !== editId)) {
      toast('Такой номер уже добавлен', 'error'); return;
    }
    if (editId) {
      updateGarageCar(uid, editId, { plate: trimPlate, brand: brand.trim(), note: note.trim(), isMain });
      toast('Автомобиль обновлён', 'success');
    } else {
      addGarageCar(uid, { id: genId('car'), plate: trimPlate, brand: brand.trim(), note: note.trim(), isMain, addedAt: new Date() });
      toast('Автомобиль добавлен', 'success');
    }
    resetForm();
  };

  const startEdit = (car) => {
    setEditId(car.id); setPlate(car.plate); setBrand(car.brand || ''); setNote(car.note || ''); setIsMain(car.isMain || false); setAdding(true);
  };

  const remove = useCallback((carId) => {
    deleteGarageCar(uid, carId);
    toast('Автомобиль удалён', 'success');
  }, [deleteGarageCar, uid]);

  return (
    <div className="garage-view">
      <div className="garage-header">
        <div className="garage-title">
          <span><AppIcon name="car" size={20} /></span>
          <div>
            <div className="garage-title-text">Мои автомобили</div>
            <div className="garage-title-sub">Машины для быстрого создания пропусков</div>
          </div>
        </div>
        {!adding && (
          <button className="btn-gold" style={{ width: 'auto', padding: '0 16px' }} onClick={() => setAdding(true)}>
            <span>+ Добавить</span>
          </button>
        )}
      </div>

      {/* Форма добавления/редактирования */}
      {adding && (
        <div className="garage-form">
          <div className="field">
            <label className="field-lbl">Гос. номер *</label>
            <input className="field-inp" placeholder="А 000 АА 000" value={plate}
              onChange={e => setPlate(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
          </div>
          <div className="field">
            <label className="field-lbl">Марка / модель</label>
            <input className="field-inp" placeholder="Toyota Camry" value={brand}
              onChange={e => setBrand(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-lbl">Заметка</label>
            <input className="field-inp" placeholder="Белый, паркинг B2" value={note}
              onChange={e => setNote(e.target.value)} />
          </div>
          <label className="field-check">
            <input type="checkbox" checked={isMain} onChange={e => setIsMain(e.target.checked)} />
            <span>Основной автомобиль</span>
          </label>
          <div className="garage-form-btns">
            <button className="btn-outline" onClick={resetForm}>Отмена</button>
            <button className="btn-gold" onClick={save}><span>{editId ? 'Сохранить' : 'Добавить'}</span></button>
          </div>
        </div>
      )}

      {/* Список машин */}
      {cars.length === 0 && !adding && (
        <div className="empty-state">
          <div className="empty-icon"><AppIcon name="car" size={28} /></div>
          <div className="empty-title">Машины не добавлены</div>
          <div className="empty-sub">Добавьте автомобиль для быстрого создания пропусков на парковку</div>
        </div>
      )}

      <div className="garage-list">
        {cars.map(car => (
          <div key={car.id} className={'garage-card' + (car.isMain ? ' main' : '')}>
            <div className="garage-plate">{car.plate}</div>
            <div className="garage-info">
              {car.brand && <div className="garage-brand">{car.brand}</div>}
              {car.note  && <div className="garage-note">{car.note}</div>}
              {car.isMain && <span className="garage-badge">Основной</span>}
            </div>
            <div className="garage-actions">
              <button className="icon-btn" onClick={() => startEdit(car)} title="Редактировать" aria-label="Редактировать"><AppIcon name="edit" /></button>
              <button className="icon-btn danger" onClick={() => remove(car.id)} title="Удалить" aria-label="Удалить"><AppIcon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
