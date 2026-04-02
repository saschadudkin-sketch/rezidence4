import { useState, useMemo, useCallback } from 'react';
import { useBlacklist, useActions } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce';
import { genId } from '../utils.js';
import { toast } from '../ui/Toasts.jsx';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';

export default function BlacklistView({ user }) {
  const blacklist = useBlacklist();
  const { addToBlacklist, removeFromBlacklist } = useActions();
  const [adding, setAdding] = useState(false);
  const [name, setName]       = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [reason, setReason]   = useState('');
  const [query, setQuery]     = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const q = debouncedQuery.trim().toLowerCase();

  // FIX [PERF]: filtered мемоизирован — без useMemo пересчитывается при каждом рендере
  const filtered = useMemo(() =>
    q ? blacklist.filter(e =>
        (e.name || '').toLowerCase().includes(q)
        || (e.carPlate || '').toLowerCase().includes(q)
        || (e.reason || '').toLowerCase().includes(q))
    : blacklist,
  [blacklist, q]);

  // FIX [PERF]: useCallback — не пересоздаётся при каждом рендере
  const handleAdd = useCallback(() => {
    if (!name.trim() && !carPlate.trim()) {
      toast('Укажите ФИО или номер авто', 'error');
      return;
    }
    addToBlacklist({
      id: genId('bl'),
      name: name.trim(),
      carPlate: carPlate.trim().toUpperCase(),
      reason: reason.trim(),
      addedBy: user.uid,
      addedAt: new Date(),
    });
    setName(''); setCarPlate(''); setReason('');
    setAdding(false);
    toast('Добавлено в чёрный список', 'success');
  }, [name, carPlate, reason, user.uid, addToBlacklist]);

  const handleRemove = useCallback((id) => {
    removeFromBlacklist(id);
    toast('Удалено из чёрного списка', 'success');
  }, [removeFromBlacklist]);

  return (
    <div>
      <div className="bl-header">
        <div>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)' }}><AppIcon name="ban" className="u-inline-icon" /> Чёрный список</span>
          <span className="bl-count">{blacklist.length}</span>
        </div>
        <button className="btn-gold u-pad-icon-btn" onClick={() => setAdding(a => !a)}>
          <span>{adding ? <><AppIcon name="close" className="u-inline-icon" /> Отмена</> : '+ Добавить'}</span>
        </button>
      </div>

      {adding && (
        <div className="bl-form">
          <div className="bl-form-row">
            <input className="field-inp" placeholder="ФИО" value={name}
              onChange={e => setName(e.target.value)} autoCapitalize="words" autoFocus />
            <input className="field-inp" placeholder="Номер авто" value={carPlate}
              onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
          </div>
          <input className="field-inp" placeholder="Причина (необязательно)" value={reason}
            onChange={e => setReason(e.target.value)} />
          <button className="btn-gold" onClick={handleAdd} style={{ marginTop: 8 }}>
            <span><AppIcon name="ban" className="u-inline-icon" /> Добавить в чёрный список</span>
          </button>
        </div>
      )}

      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" /></span>
        <input className="search-inp" placeholder="Поиск по ФИО, номеру авто..."
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {filtered.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : 'Список пуст'}
          subtitle={q ? 'Попробуйте другой запрос' : 'Нажмите «+ Добавить» чтобы внести запись'}
        />
      )}

      <div className="bl-list">
        {filtered.map(entry => (
          <div key={entry.id} className="bl-entry">
            <div className="bl-entry-main">
              <div className="bl-entry-icon"><AppIcon name="ban" /></div>
              <div className="bl-entry-info">
                {entry.name && <div className="bl-entry-name">{entry.name}</div>}
                {entry.carPlate && <div className="bl-entry-plate">{entry.carPlate}</div>}
                {entry.reason && <div className="bl-entry-reason">{entry.reason}</div>}
                <div className="bl-entry-date">
                  {entry.addedAt ? new Date(entry.addedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                </div>
              </div>
              <button className="perm-del" onClick={() => handleRemove(entry.id)} title="Удалить" aria-label="Удалить"><AppIcon name="close" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
