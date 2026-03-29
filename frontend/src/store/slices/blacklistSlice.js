// ─── Начальные данные ────────────────────────────────────────────────────────

export const INITIAL_BLACKLIST = [
  { id: 'bl1', name: 'Петров Сергей',    carPlate: '', reason: 'Нарушение порядка', addedBy: 'u5', addedAt: new Date(Date.now() - 7 * 86_400_000) },
  { id: 'bl2', name: '',                  carPlate: 'Х666ХХ77', reason: 'Парковка на газоне', addedBy: 'u5', addedAt: new Date(Date.now() - 3 * 86_400_000) },
];

// ─── Утилита проверки ────────────────────────────────────────────────────────

/**
 * Проверяет, есть ли совпадение заявки с чёрным списком.
 * Возвращает запись из списка или null.
 */
export function checkBlacklist(req, blacklist) {
  if (!blacklist || blacklist.length === 0) return null;
  const vName = (req.visitorName || '').toLowerCase().trim();
  const plate = (req.carPlate || '').replace(/[\s-]/g, '').toLowerCase();

  for (const entry of blacklist) {
    const eName = (entry.name || '').toLowerCase().trim();
    const ePlate = (entry.carPlate || '').replace(/[\s-]/g, '').toLowerCase();
    // Полное совпадение имени или номера (не подстрока)
    if (eName && vName && vName === eName) return entry;
    // Для номеров авто — точное совпадение (без пробелов/тире)
    if (ePlate && plate && plate === ePlate) return entry;
    // Если в ЧС фамилия+имя, проверяем что все слова из ЧС есть в имени гостя
    if (eName && vName && eName.includes(' ')) {
      const blWords = eName.split(/\s+/);
      const vWords = vName.split(/\s+/);
      if (blWords.length > 0 && blWords.every(w => vWords.includes(w))) return entry;
    }
  }
  return null;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function blacklistReducer(state, action) {
  switch (action.type) {

    case 'BLACKLIST_ADD':
      return { ...state, blacklist: [action.entry, ...state.blacklist] };

    case 'BLACKLIST_REMOVE':
      return { ...state, blacklist: state.blacklist.filter(e => e.id !== action.id) };

    case 'BLACKLIST_SET_ALL':
      return { ...state, blacklist: action.entries };

    default:
      return state;
  }
}
