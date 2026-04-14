import { useState, useMemo, useCallback } from 'react';
import { useBlacklist, useActions } from '../store/AppStore';
import { useDebounce } from '../hooks/useDebounce';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import { VirtualList } from '../ui/VirtualList';
import { sanitizeText, sanitizeCarPlate, validateAtLeastOne } from '../utils/inputSanitizer';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { AppUser } from '../store/slices/usersSlice';
import type { BlacklistEntry } from '../store/slices/blacklistSlice';

type BlacklistViewProps = {
  user: Pick<AppUser, 'uid'>;
};

export default function BlacklistView({ user }: BlacklistViewProps) {
  const blacklist = useBlacklist();
  const { addToBlacklist, removeFromBlacklist } = useActions();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 250);
  const q = debouncedQuery.trim().toLowerCase();
  const emptyCopy = getViewStateCopy('blacklist', 'empty');

  const filtered = useMemo(
    () => (q
      ? blacklist.filter((entry) =>
        (entry.name || '').toLowerCase().includes(q)
        || (entry.carPlate || '').toLowerCase().includes(q)
        || (entry.reason || '').toLowerCase().includes(q))
      : blacklist),
    [blacklist, q],
  );

  const handleAdd = useCallback(() => {
    const err = validateAtLeastOne([name, carPlate], 'Укажите ФИО или номер авто');
    if (err) {
      toast(err, 'error');
      return;
    }

    addToBlacklist({
      id: genId('bl'),
      name: sanitizeText(name),
      carPlate: sanitizeCarPlate(carPlate),
      reason: sanitizeText(reason),
      addedBy: user.uid,
      addedAt: new Date(),
    });
    setName('');
    setCarPlate('');
    setReason('');
    setAdding(false);
    toast('Добавлено в чёрный список', 'success');
  }, [name, carPlate, reason, user.uid, addToBlacklist]);

  const handleRemove = useCallback((id: string) => {
    removeFromBlacklist(id);
    toast('Удалено из чёрного списка', 'success');
  }, [removeFromBlacklist]);

  const toggleAdding = useCallback(() => {
    setAdding((value) => !value);
  }, []);

  const renderEntry = useCallback((entry: BlacklistEntry) => (
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
        <button className="perm-del" onClick={() => setConfirmDelete(entry.id)} title="Удалить" aria-label="Удалить запись из чёрного списка"><AppIcon name="close" /></button>
      </div>
    </div>
  ), []);

  return (
    <div>
      <div className="bl-header">
        <div className="bl-header-copy">
          <span className="bl-title"><AppIcon name="ban" className="u-inline-icon" /> Чёрный список</span>
          <span className="bl-count">{blacklist.length}</span>
        </div>
        <button className="btn-gold u-pad-icon-btn" onClick={toggleAdding}>
          <span>{adding ? <><AppIcon name="close" className="u-inline-icon" /> Отмена</> : '+ Добавить'}</span>
        </button>
      </div>

      {adding && (
        <div className="bl-form">
          <div className="bl-form-row">
            <div className="bl-field">
              <label className="field-lbl" htmlFor="blacklist-name">ФИО</label>
              <input
                id="blacklist-name"
                className="field-inp"
                placeholder="ФИО"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoCapitalize="words"
                autoFocus
              />
            </div>
            <div className="bl-field">
              <label className="field-lbl" htmlFor="blacklist-car">Номер авто</label>
              <input
                id="blacklist-car"
                className="field-inp"
                placeholder="Номер авто"
                value={carPlate}
                onChange={(event) => setCarPlate(event.target.value)}
                autoCapitalize="characters"
              />
            </div>
          </div>
          <label className="field-lbl" htmlFor="blacklist-reason">Причина <span className="u-t4">(необязательно)</span></label>
          <input
            id="blacklist-reason"
            className="field-inp"
            placeholder="Краткий комментарий для поста охраны"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button className="btn-gold u-mt-8" onClick={handleAdd}>
            <span><AppIcon name="ban" className="u-inline-icon" /> Добавить в чёрный список</span>
          </button>
        </div>
      )}

      <div className="search-wrap u-mb16">
        <span className="search-ico"><AppIcon name="search" /></span>
        <input
          className="search-inp"
          aria-label="Поиск по чёрному списку"
          placeholder="Поиск по ФИО, номеру авто..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <StateBlock
          type="empty"
          title={q ? 'Ничего не найдено' : emptyCopy.title}
          subtitle={q ? 'Попробуйте другой запрос' : emptyCopy.subtitle}
        />
      )}

      <VirtualList
        items={filtered}
        estimateSize={80}
        className="bl-list"
        renderItem={renderEntry}
      />
      {confirmDelete && (
        <ConfirmDialog
          message="Удалить запись из чёрного списка? Это действие нельзя отменить."
          confirmLabel="Удалить"
          onConfirm={() => {
            handleRemove(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
