'use strict';

const { scrubEvent, scrubString } = require('../sentry');

describe('sentry scrubber (ФЗ-152)', () => {
  test('scrubs phone numbers from strings', () => {
    expect(scrubString('Contact +7 (495) 123-45-67 urgent'))
      .toBe('Contact [Filtered Phone] urgent');
  });

  test('scrubs bearer tokens and authorization fragments', () => {
    expect(scrubString('Authorization: Bearer abc.def.ghi'))
      .toMatch(/\[Filtered Token\]/);
  });

  test('redacts phone inside nested event payloads', () => {
    const event = {
      message: 'user +7 495 111-22-33 failed',
      request: {
        headers: { Authorization: 'Bearer xyz', Cookie: 'rezi_at=abc' },
        url: 'https://api.example.com/path?token=secret&foo=bar',
      },
      extra: {
        phone: '+74951234567',
        nested: { token: 'hush' },
      },
    };
    const out = scrubEvent(event);
    expect(out.message).toMatch(/\[Filtered Phone\]/);
    expect(out.request.headers.Authorization).toBe('[Filtered Token]');
    expect(out.request.headers.Cookie).toBe('[Filtered Cookie]');
    // URL token is stripped.  The TOKEN_RE rule matches the whole `token=secret`
    // fragment before the narrower URL_TOKEN_RE gets a chance, so the result
    // may say `[Filtered Token]` or `token=[Filtered]` — either is acceptable
    // provided the secret itself is gone.
    expect(out.request.url).not.toContain('secret');
    expect(out.request.url).toMatch(/\[Filtered/);
    expect(out.extra.phone).toMatch(/\[Filtered/);
    expect(out.extra.nested.token).toMatch(/\[Filtered/);
  });

  test('survives circular references', () => {
    const event = { message: 'ok' };
    event.self = event;
    expect(() => scrubEvent(event)).not.toThrow();
  });
});
