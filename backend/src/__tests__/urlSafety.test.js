'use strict';

// SEC [AUDIT-SSRF]: regression-тесты для outbound URL guard.

const {
  validateOutboundUrl,
  isBlockedHost,
  isPrivateIPv4,
  isPrivateIPv6,
} = require('../lib/urlSafety');

describe('isPrivateIPv4', () => {
  test.each([
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.31.255.254'],
    ['192.168.1.1'],
    ['127.0.0.1'],
    ['127.255.255.255'],
    ['169.254.169.254'],
    ['169.254.170.2'],
    ['100.64.0.1'],
    ['100.127.255.254'],
    ['0.0.0.0'],
    ['224.0.0.1'],
  ])('%s — private', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
  });

  test.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.0.1'], // граница CGNAT — не приватный
    ['172.32.0.1'],
    ['100.63.0.1'], // граница CGNAT
    ['100.128.0.1'],
    ['11.0.0.1'],
    ['200.0.0.1'],
  ])('%s — public', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });
});

describe('isPrivateIPv6', () => {
  test.each([
    ['::1'],
    ['::'],
    ['fe80::1'],
    ['fc00::1'],
    ['fd12:3456::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:10.0.0.1'],
  ])('%s — private', (ip) => {
    expect(isPrivateIPv6(ip)).toBe(true);
  });

  test.each([
    ['2001:db8::1'],
    ['::ffff:8.8.8.8'],
  ])('%s — public', (ip) => {
    expect(isPrivateIPv6(ip)).toBe(false);
  });
});

describe('isBlockedHost', () => {
  test.each([
    ['localhost'],
    ['LOCALHOST'],
    ['localhost.localdomain'],
    ['metadata.google.internal'],
    ['metadata.googleapis.com'],
    ['metadata.azure.com'],
    ['169.254.169.254'],
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['[::1]'],
  ])('%s — blocked', (h) => {
    expect(isBlockedHost(h)).toBe(true);
  });

  test.each([
    ['example.com'],
    ['api.telegram.org'],
    ['hooks.example.com'],
    ['8.8.8.8'],
  ])('%s — allowed', (h) => {
    expect(isBlockedHost(h)).toBe(false);
  });

  test('пустая строка / non-string — заблокировано', () => {
    expect(isBlockedHost('')).toBe(true);
    expect(isBlockedHost(null)).toBe(true);
    expect(isBlockedHost(undefined)).toBe(true);
    expect(isBlockedHost(123)).toBe(true);
  });
});

describe('validateOutboundUrl', () => {
  test('public https URL проходит', () => {
    const r = validateOutboundUrl('https://api.example.com/hook');
    expect(r.ok).toBe(true);
    expect(r.parsedUrl.hostname).toBe('api.example.com');
  });

  test('http запрещён по дефолту (allowedProtocols=[https:])', () => {
    const r = validateOutboundUrl('http://api.example.com/hook');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden_protocol/);
  });

  test('http разрешается явно через options', () => {
    const r = validateOutboundUrl('http://api.example.com/hook', {
      allowedProtocols: ['http:', 'https:'],
    });
    expect(r.ok).toBe(true);
  });

  test('javascript: схема блокируется', () => {
    const r = validateOutboundUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden_protocol/);
  });

  test('file:// блокируется', () => {
    const r = validateOutboundUrl('file:///etc/passwd');
    expect(r.ok).toBe(false);
  });

  test('gopher:// блокируется', () => {
    const r = validateOutboundUrl('gopher://example.com:11211/');
    expect(r.ok).toBe(false);
  });

  test.each([
    ['https://localhost/hook'],
    ['https://127.0.0.1/hook'],
    ['https://169.254.169.254/latest/meta-data/'],
    ['https://10.0.0.1/internal'],
    ['https://192.168.1.1/admin'],
    ['https://172.20.0.5/api'],
    ['https://metadata.google.internal/'],
    ['https://metadata.azure.com/'],
    ['https://[::1]/'],
  ])('SSRF target %s блокируется', (url) => {
    const r = validateOutboundUrl(url);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden_host/);
  });

  test('credentials в URL отвергаются', () => {
    const r = validateOutboundUrl('https://user:pass@api.example.com/');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('credentials_in_url_forbidden');
  });

  test('пустая строка — url_required', () => {
    expect(validateOutboundUrl('').reason).toBe('url_required');
    expect(validateOutboundUrl(null).reason).toBe('url_required');
    expect(validateOutboundUrl(undefined).reason).toBe('url_required');
  });

  test('garbage — invalid_url', () => {
    expect(validateOutboundUrl('not a url').reason).toBe('invalid_url');
  });

  test('CGNAT IP блокируется (RFC 6598)', () => {
    const r = validateOutboundUrl('https://100.64.0.1/');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden_host/);
  });

  test('multicast IP блокируется', () => {
    const r = validateOutboundUrl('https://224.0.0.1/');
    expect(r.ok).toBe(false);
  });

  test('обычный публичный hostname с TLS работает', () => {
    expect(validateOutboundUrl('https://hooks.slack.com/services/T00/B00/xxx').ok).toBe(true);
    expect(validateOutboundUrl('https://api.telegram.org/bot123/sendMessage').ok).toBe(true);
  });
});
