'use strict';

// SEC [AUDIT-SSRF]: defense-in-depth для outbound HTTP (webhooks + future
// integrations).
//
// Threat model: malicious admin / compromised admin-account / DB-write
// уязвимость → регистрация webhook URL'а, указывающего на:
//   • cloud-metadata IP (169.254.169.254 / metadata.google.internal / ...)
//     → утечка cloud IAM credentials через `webhooks.last_error`
//   • internal services (10.x / 172.16-31.x / 192.168.x / 127.x)
//     → доступ к внутренним API из вне периметра
//   • file:// / gopher:// / ftp:// схемы → file-read / SMTP-relay
//
// Не идеальная защита: DNS-rebinding (домен резолвится сначала в публичный
// IP — пройдёт validation, потом в private — fetch уже попадает на private).
// Полная защита требует DNS-resolve + явная подача IP в URL и Host header.
// Текущий baseline ловит ~90% случаев тривиального SSRF.  Для critical paths
// рекомендую выделенный outbound proxy.
//
// Вызывается:
//   1. На входе (POST/PATCH /api/v1/webhooks) — отказываем 400 при создании
//   2. Перед fetch'ем в webhookAdapter — defense-in-depth (если URL уже в БД
//      попал не через наш роут — например, миграция или прямой INSERT).

// IPv4 private / loopback / link-local / reserved
const PRIVATE_IPV4_PATTERNS = [
  /^10\./,                                // RFC 1918
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,        // RFC 1918
  /^192\.168\./,                           // RFC 1918
  /^127\./,                                // loopback
  /^169\.254\./,                           // link-local + AWS/GCP/Azure metadata
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,  // RFC 6598 CGNAT
  /^0\./,                                  // 0.0.0.0/8
  /^2(2[4-9]|[3-5][0-9])\./,               // multicast / reserved
];

// Hostnames, которые надо блокировать вне зависимости от IP-резолва.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  // Cloud metadata endpoints (по docs провайдеров)
  'metadata.google.internal',
  'metadata.googleapis.com',
  'metadata.azure.com',
  '169.254.169.254',
  '169.254.170.2',                         // ECS task metadata
  // Alibaba metadata (резолвится в 100.100.100.200 — это в CGNAT range,
  // но для верности — host тоже)
  '100.100.100.200',
]);

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function isPrivateIPv4(ip) {
  return PRIVATE_IPV4_PATTERNS.some((re) => re.test(ip));
}

function isPrivateIPv6(ip) {
  // Стрипаем IPv6-bracket нотацию [::1]
  const h = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;  // fc00::/7 ULA
  // IPv4-mapped IPv6: ::ffff:127.0.0.1 → проверяем как IPv4
  const v4mapped = h.match(/^::ffff:((\d{1,3}\.){3}\d{1,3})$/);
  if (v4mapped && isPrivateIPv4(v4mapped[1])) return true;
  return false;
}

/**
 * isBlockedHost — true, если hostname/IP относится к private/internal/metadata.
 * Чувствителен к регистру входа (приводит к lowercase).
 */
function isBlockedHost(hostname) {
  if (typeof hostname !== 'string' || !hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (IPV4_RE.test(h)) return isPrivateIPv4(h);
  if (h.includes(':')) return isPrivateIPv6(h);
  return false;
}

/**
 * validateOutboundUrl — основной guard.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {string[]} [options.allowedProtocols=['https:']] — protocol allowlist;
 *   по дефолту только https (см. webhooks.js — он уже enforce'ит это).
 * @returns {{ ok: true, parsedUrl: URL } | { ok: false, reason: string }}
 */
function validateOutboundUrl(rawUrl, options = {}) {
  const allowedProtocols = options.allowedProtocols || ['https:'];
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return { ok: false, reason: 'url_required' };
  }
  // URL constructor accepts inputs like 'javascript:alert(1)' — отдельно
  // проверим protocol. file:/// тоже парсится корректно — отсеется allowlist'ом.
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { ok: false, reason: `forbidden_protocol:${parsed.protocol}` };
  }
  // username/password в URL'е — стандартный SSRF-trick для обхода фильтров,
  // плюс попадает в логи через path.  Не разрешаем.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials_in_url_forbidden' };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: `forbidden_host:${parsed.hostname}` };
  }
  return { ok: true, parsedUrl: parsed };
}

module.exports = {
  validateOutboundUrl,
  isBlockedHost,
  isPrivateIPv4,
  isPrivateIPv6,
  BLOCKED_HOSTNAMES,
};
