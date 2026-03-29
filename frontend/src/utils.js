/**
 * src/utils.js — barrel-файл для обратной совместимости.
 * Логика разбита по модулям в src/utils/:
 *   phoneUtils.js  — normalizePhone, findByPhone
 *   idUtils.js     — genId
 *   dateUtils.js   — fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs
 *   notifUtils.js  — requestNotifPerm, sendNotif, playAlert
 *   swUtils.js     — registerSW
 */
export { normalizePhone, findByPhone }                            from './utils/phoneUtils';
export { genId }                                                  from './utils/idUtils';
export { fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs } from './utils/dateUtils';
export { requestNotifPerm, sendNotif, playAlert }                 from './utils/notifUtils';
export { registerSW }                                             from './utils/swUtils';
