/**
 * config/features.js — флаги функциональности
 *
 * FIX [AUDIT]: FEATURES.FIREBASE_LIVE удалён — Firebase убран из проекта,
 * флаг был всегда false и только вводил в заблуждение читателей кода.
 * Режим приложения (live/demo) теперь управляется исключительно через
 * REACT_APP_RUNTIME_MODE в .env (см. runtimeMode.js).
 *
 * Этот файл оставлен как точка расширения для будущих feature-флагов.
 */

export const FEATURES = {};
