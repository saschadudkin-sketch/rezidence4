/**
 * passValidation.js — правила валидации пропуска
 */

// FIX [BUG-2]: нормализация телефона для сравнения — убираем всё кроме цифр
function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  // RU-формат: считаем 8XXXXXXXXXX и 7XXXXXXXXXX эквивалентными
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

// FIX [BUG-2]: нормализация номера авто — убираем пробелы, нижний регистр
function normalizeCarPlate(plate) {
  return typeof plate === 'string' ? plate.replace(/\s/g, '').toLowerCase() : '';
}

export function validatePassByRules(pass, { blacklist = [], now = new Date() } = {}) {
  if (!pass) return { status: 'denied', reason: 'not_found' };

  const validUntil = pass.validUntil ? new Date(pass.validUntil) : null;
  if (validUntil && validUntil.getTime() < now.getTime()) {
    return { status: 'denied', reason: 'expired' };
  }

  // FIX [BUG-2]: проверяем blacklist по всем доступным идентификаторам:
  // userId, телефону и номеру авто. Ранее проверялся только userId —
  // человек с совпадающим номером машины мог пройти с другим userId.
  const passUserId  = pass.userId || pass.uid;
  const passPhone   = normalizePhone(pass.visitorPhone);
  const passPlate   = normalizeCarPlate(pass.carPlate);

  const isBlacklisted = blacklist.some(item => {
    // 1. По userId
    const itemUserId = item.userId || item.uid;
    if (itemUserId && passUserId && itemUserId === passUserId) return true;

    // 2. По телефону (сравниваем нормализованные строки цифр)
    const itemPhone = normalizePhone(item.phone);
    if (itemPhone && passPhone && itemPhone === passPhone) return true;

    // 3. По номеру автомобиля (без пробелов, нижний регистр)
    const itemPlate = normalizeCarPlate(item.carPlate);
    if (itemPlate && passPlate && itemPlate === passPlate) return true;

    return false;
  });

  if (isBlacklisted) {
    return { status: 'denied', reason: 'blacklisted' };
  }

  return { status: 'allowed', reason: 'ok' };
}
