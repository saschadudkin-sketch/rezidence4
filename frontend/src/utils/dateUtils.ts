import type { AppRequest } from '../store/slices/requestsSlice';

/** Относительная дата: «только что», «5 мин. назад», «сегодня», «вчера», «дд.мм» */
export const fmtDate = (d?: string | Date | null) => {
  if (!d) return '';
  const dt   = d instanceof Date ? d : new Date(d);
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000)    return 'только что';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' мин. назад';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dt >= today) return 'сегодня';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dt >= yesterday) return 'вчера';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

/** Время в формате ЧЧ:ММ */
export const fmtTime = (d?: string | Date | null) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

/** Фильтрует заявки по периоду: «all» | «today» | «week» */
export const filterByPeriod = (arr: AppRequest[], period: string) => {
  if (period !== 'today' && period !== 'week') return arr;
  const now = Date.now();
  const ms  = period === 'today' ? 86_400_000 : 7 * 86_400_000;
  return arr.filter((r) => now - new Date(r.createdAt).getTime() < ms);
};

/** Группирует заявки по дате создания: «Сегодня» / «Вчера» / «Ранее»
 *  FIX [PERF]: один проход вместо трёх; Date создаётся один раз per item (не 3x)
 */
export const groupReqs = (arr: AppRequest[]) => {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const todayTs   = today.getTime();
  const yestTs    = todayTs - 86_400_000;
  const groups: Record<'Сегодня' | 'Вчера' | 'Ранее', AppRequest[]> = { Сегодня: [], Вчера: [], Ранее: [] };
  for (const r of arr) {
    const ts = new Date(r.createdAt).getTime();
    if (ts >= todayTs)       groups['Сегодня'].push(r);
    else if (ts >= yestTs)   groups['Вчера'].push(r);
    else                     groups['Ранее'].push(r);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
};

/** Сортирует заявки: сначала pending/scheduled, потом по дате убыв.
 *  FIX [PERF]: кэшируем ts per item — new Date() вызывается O(n), не O(n log n)
 */
export const sortReqs = (arr: AppRequest[]) => {
  const statusOrder: Partial<Record<AppRequest['status'], number>> = { pending: 0, scheduled: 1 };
  // Precompute timestamps to avoid repeated new Date() inside comparator
  const withTs = arr.map(r => ({ r, ts: new Date(r.createdAt).getTime(), o: statusOrder[r.status] ?? 2 }));
  withTs.sort((a, b) => a.o !== b.o ? a.o - b.o : b.ts - a.ts);
  return withTs.map(({ r }) => r);
};
