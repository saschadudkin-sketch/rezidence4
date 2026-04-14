import { describe, expect, test } from 'vitest';
import { scrubSentryEvent } from './sentryPrivacy';

describe('scrubSentryEvent', () => {
  test('redacts phones and tokens', () => {
    const event = scrubSentryEvent({
      message: 'Bearer abc123 for +7 916 123-45-67',
      request: {
        headers: {
          Authorization: 'Bearer abc123',
          Cookie: 'refreshToken=secret',
        },
        url: 'https://app.example.test/path?token=abc123',
      },
      breadcrumbs: [{ message: 'jwt=secret' }],
    });

    expect(event.message).toContain('[Filtered Token]');
    expect(event.message).toContain('[Filtered Phone]');
    expect(event.request?.headers?.Authorization).toBe('[Filtered Token]');
    expect(event.request?.headers?.Cookie).toBe('[Filtered Cookie]');
    expect(event.request?.url).toContain('[Filtered');
  });
});
