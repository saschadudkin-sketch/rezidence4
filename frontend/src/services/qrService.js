/**
 * services/qrService.js — генерация и верификация QR-кодов пропусков.
 *
 * QR содержит JSON: { id, type, visitorName, createdByApt, validUntil }
 * Охранник сканирует → система показывает данные пропуска и кнопку «Пропустить».
 */

import QRCode from 'qrcode';

/**
 * Генерирует data-URL QR-кода для пропуска.
 * @param {Object} req — объект заявки
 * @returns {Promise<string>} data:image/png;base64,...
 */
export async function generatePassQR(req) {
  const payload = JSON.stringify({
    id:           req.id,
    type:         req.type,
    category:     req.category,
    visitorName:  req.visitorName || '—',
    createdByApt: req.createdByApt || '—',
    createdByName: req.createdByName || '—',
    carPlate:     req.carPlate || null,
    passDuration: req.passDuration || 'once',
    validUntil:   req.validUntil instanceof Date ? req.validUntil.toISOString() : (req.validUntil || null),
    createdAt:    req.createdAt instanceof Date ? req.createdAt.toISOString() : req.createdAt,
  });

  return QRCode.toDataURL(payload, {
    width: 256,
    margin: 2,
    color: {
      dark:  '#1C1A16',
      light: '#FAF8F4',
    },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Парсит данные из отсканированного QR-кода.
 * @param {string} raw — сырая строка из QR
 * @returns {Object|null} распарсенный объект или null
 */
export function parsePassQR(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data.id || !data.type) return null;
    return data;
  } catch {
    return null;
  }
}
