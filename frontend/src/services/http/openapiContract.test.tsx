import { readFileSync } from 'fs';
import { resolve } from 'path';

const openapi = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/openapi.json'), 'utf8'));

describe('OpenAPI critical endpoint compatibility', () => {
  test.each([
    '/api/v1/requests',
    '/api/v1/chat/messages',
    '/api/v1/users',
  ])('contains endpoint %s', (endpoint) => {
    expect(openapi.paths?.[endpoint]).toBeTruthy();
  });

  test('critical GET endpoints declare JSON responses', () => {
    const checks = [
      ['/api/v1/requests', 'get'],
      ['/api/v1/chat/messages', 'get'],
      ['/api/v1/users', 'get'],
    ];

    for (const [path, method] of checks) {
      const responses = openapi.paths?.[path]?.[method]?.responses || {};
      const status = responses['200'] || responses['201'];
      expect(status?.content?.['application/json']).toBeTruthy();
    }
  });
});
