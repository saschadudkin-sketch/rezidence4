import { useState, useCallback } from 'react';
import { useGarage, useActions } from '../store/AppStore';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import type { AppUser } from '../store/slices/usersSlice';
import type { Car } from '../store/slices/garageSlice';

type GarageViewProps = {
  user: AppUser;
  targetUid?: string;
};

export default function GarageView({ user, targetUid }: GarageViewProps) {
  const uid = targetUid || user.uid;
  const cars = useGarage(uid);
  const { addGarageCar, updateGarageCar, deleteGarageCar } = useActions();

  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [note, setNote] = useState('');
  const emptyCopy = getViewStateCopy('garage', 'empty');

  const resetForm = useCallback(() => {
    setPlate('');
    setBrand('');
    setNote('');
    setAdding(false);
    setEditId(null);
  }, []);

  const save = () => {
    const trimPlate = plate.trim().toUpperCase();
    if (!trimPlate) {
      toast('Введите номер автомобиля', 'error');
      return;
    }
    if (cars.some((car) => car.plate === trimPlate && car.id !== editId)) {
      toast('Такой номер уже добавлен', 'error');
      return;
    }
    if (editId) {
      updateGarageCar(uid, editId, { plate: trimPlate, brand: brand.trim(), note: note.trim() });
      toast('Автомобиль обновлён', 'success');
    } else {
      addGarageCar(uid, { id: genId('car'), plate: trimPlate, brand: brand.trim(), note: note.trim(), addedAt: new Date() });
      toast('Автомобиль добавлен', 'success');
    }
    resetForm();
  };

  const startEdit = (car: Car) => {
    setEditId(car.id);
    setPlate(car.plate);
    setBrand(car.brand || '');
    setNote(car.note || '');
    setAdding(true);
  };

  const remove = useCallback((carId: string) => {
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
          <button className="btn-gold u-w-auto" onClick={() => setAdding(true)}>
            <span>+ Добавить</span>
          </button>
        )}
      </div>

      {adding && (
        <div className="garage-form">
          <div className="field">
            <label className="field-lbl">Гос. номер *</label>
            <input className="field-inp" placeholder="А 000 АА 000" value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === 'Enter' && save()} autoFocus />
          </div>
          <div className="field">
            <label className="field-lbl">Марка / модель</label>
            <input className="field-inp" placeholder="Toyota Camry" value={brand} onChange={(event) => setBrand(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-lbl">Заметка</label>
            <input className="field-inp" placeholder="Белый, парковка место 101" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="garage-form-btns">
            <button className="btn-outline" onClick={resetForm}>Отмена</button>
            <button className="btn-gold" onClick={save}><span>{editId ? 'Сохранить' : 'Добавить'}</span></button>
          </div>
        </div>
      )}

      {cars.length === 0 && !adding && (
        <StateBlock type="empty" title={emptyCopy.title} subtitle={emptyCopy.subtitle} />
      )}

      <div className="garage-list">
        {cars.map((car) => (
          <div key={car.id} className="garage-card">
            <div className="garage-plate">{car.plate}</div>
            <div className="garage-info">
              {car.brand && <div className="garage-brand">{car.brand}</div>}
              {car.note && <div className="garage-note">{car.note}</div>}
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
