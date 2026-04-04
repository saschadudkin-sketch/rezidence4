/**
 * limits.ts — CQ-02: migrated from limits.js
 * FE-03: именованные константы вместо магических чисел.
 */

/** Максимальное кол-во фото на одну заявку / сообщение */
export const MAX_PHOTOS_PER_REQUEST = 5 as const;

/** Максимальный размер загружаемого файла (10 МБ) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 as const;

/** Кол-во сообщений чата в одном запросе истории */
export const CHAT_BATCH_SIZE = 60 as const;

/** Задержка дебаунса для поиска (мс) */
export const SEARCH_DEBOUNCE_MS = 500 as const;

/** Максимальная ширина фото при сжатии (px) */
export const PHOTO_MAX_WIDTH_PX = 1024 as const;

/** Качество JPEG при сжатии фото (0–1) */
export const PHOTO_JPEG_QUALITY = 0.72 as const;

/** Таймаут первого SSE-подключения (мс) — медленный сервер/4G */
export const FIRST_CONNECT_TIMEOUT_MS = 5_000 as const;

/** Таймаут повторного SSE-подключения (мс) — reconnect быстрее первого запуска */
export const RECONNECT_TIMEOUT_MS = 3_000 as const;

/** Cooldown между повторными отправками OTP по умолчанию (сек) */
export const OTP_COOLDOWN_SECONDS = 30 as const;

/** Максимальный допустимый cooldown из ответа сервера (сек) — SEC-02 */
export const OTP_RETRY_AFTER_MAX_SECONDS = 300 as const;
