'use strict';

// platform-v1 Phase 3 — vehicle plate normalization.
// Spec: docs/product/specs/platform-v1/vehicles-spec.md §6.1
//
// Russian plate letters (А, В, Е, К, М, Н, О, Р, С, Т, У, Х) are restricted
// to glyphs that look identical in Cyrillic and Latin.  Operators often input
// them in Cyrillic while СКУД-интеграторы/OCR типично возвращают Latin.
// Нормализуем к Latin upper-case, убираем пробелы/дефисы/любой мусор, чтобы
// хранить и индексировать в одной канонической форме.
//
// Маппинг — строго 12 визуально неразличимых пар:
//   А↔A, В↔B, Е↔E, К↔K, М↔M, Н↔H, О↔O, Р↔P, С↔C, Т↔T, У↔Y, Х↔X
// Остальные кириллические буквы (Ж, Ш, Щ, Ю и т.п.) в российских номерах
// не используются, поэтому помечаем их как inval.* по символу (метод не
// бросает, но результат «А001ЖА77» будет `A001?A77` — сервис может на это
// ответить 422).

const CYR_TO_LAT = Object.freeze({
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
  'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
  'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H',
  'о': 'O', 'р': 'P', 'с': 'C', 'т': 'T', 'у': 'Y', 'х': 'X',
});

// Russian civil plate format: one letter + 3 digits + two letters + 2 or 3 digit region.
// Example: A001AA77, A001AA177.  Service plates, trailer plates etc. — более широкие
// форматы; regex здесь — подсказка, не хард-валидатор (валидация — 20-char limit БД).
const STANDARD_RU_PLATE = /^[ABEKMHOPCTYX]\d{3}[ABEKMHOPCTYX]{2}\d{2,3}$/;

/**
 * Нормализует госномер: Latin upper-case, без пробелов/дефисов/не-буквенно-цифр.
 *
 * @param {unknown} input — что угодно (строка/null/undefined/число)
 * @returns {string} — нормализованная строка или '' если input не строка
 *
 * Примеры:
 *   'А 001 АА 77'   → 'A001AA77'
 *   'а001аа77'      → 'A001AA77'  (Cyrillic lower → Latin upper)
 *   'A-001-AA-77'   → 'A001AA77'
 *   'a001aa77'      → 'A001AA77'  (Latin lower → Latin upper)
 *   ''              → ''
 *   null/undefined  → ''
 */
function normalizePlate(input) {
  if (typeof input !== 'string') return '';
  let out = '';
  for (const ch of input) {
    // 1) Transliter Cyrillic if applicable
    const mapped = CYR_TO_LAT[ch];
    if (mapped) { out += mapped; continue; }
    // 2) Drop anything that's not alphanumeric (spaces, dashes, dots, etc.)
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toUpperCase();
    }
  }
  return out;
}

/**
 * Проверяет, что `plate` похож на стандартный российский гражданский номер.
 * Используется на entry-points API для 400-валидации; not-standard plates
 * (dealership, trailer, service) пропускаем — спец-валидация в сервисе.
 */
function looksLikeRuPlate(normalizedPlate) {
  return typeof normalizedPlate === 'string' && STANDARD_RU_PLATE.test(normalizedPlate);
}

module.exports = {
  normalizePlate,
  looksLikeRuPlate,
  CYR_TO_LAT,
};
