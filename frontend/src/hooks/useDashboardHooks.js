/**
 * hooks/useDashboardHooks.js — barrel re-export (обратная совместимость).
 *
 * ИЗМЕНЕНИЕ: монолитный файл 283 строки разбит на 5 отдельных хуков.
 * Этот файл остаётся для обратной совместимости — ни один импорт не изменился.
 *
 * Хуки теперь живут в:
 *   hooks/useTheme.js              — тема: авто / светлая / тёмная
 *   hooks/useNavBadges.js          — счётчики навигации
 *   hooks/useLiveSync.js           — SSE-синхронизация (+ isLoading)
 *   hooks/usePushNotifications.js  — push + PWA badge
 *   hooks/useArrivalNotifier.js    — уведомление жильцу о входе гостя
 *   hooks/useNavigation.js         — активный таб + переход
 */
export { useTheme }              from './useTheme.js';
export { useNavBadges }          from './useNavBadges.js';
export { useLiveSync }           from './useLiveSync.js';
export { usePushNotifications }  from './usePushNotifications.js';
export { useArrivalNotifier }    from './useArrivalNotifier.js';
export { useNavigation }         from './useNavigation.js';
