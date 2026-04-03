/**
 * limits.js — FE-03: именованные константы вместо магических чисел.
 * Централизованный источник правды для всех лимитов приложения.
 *
 * Использование:
 *   import { MAX_PHOTOS_PER_REQUEST, MAX_FILE_SIZE_BYTES } from '../constants/limits';
 */

/** Максимальное кол-во фото на одну заявку / сообщение */
export const MAX_PHOTOS_PER_REQUEST = 5;

/** Максимальный размер загружаемого файла (10 МБ) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Кол-во сообщений чата в одном запросе истории */
export const CHAT_BATCH_SIZE = 60;

/** Задержка дебаунса для поиска (мс) */
export const SEARCH_DEBOUNCE_MS = 500;

/** Максимальная ширина фото при сжатии (px) */
export const PHOTO_MAX_WIDTH_PX = 1024;

/** Качество JPEG при сжатии фото (0–1) */
export const PHOTO_JPEG_QUALITY = 0.72;

/** Cooldown между повторными отправками OTP по умолчанию (сек) */
export const OTP_COOLDOWN_SECONDS = 30;

/** Максимальный допустимый cooldown из ответа сервера (сек) — SEC-02 */
export const OTP_RETRY_AFTER_MAX_SECONDS = 300;
