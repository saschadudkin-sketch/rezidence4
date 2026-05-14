import fs from 'node:fs';
import path from 'node:path';

describe('v1 api client tenant/base-url wiring', () => {
  test('uses shared API base URL and X-Property-Slug header behavior', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/v1/api/client.ts'), 'utf8');
    expect(source).toContain("import { API_BASE_URL } from '../../config/apiBaseUrl'");
    expect(source).toContain('const API_BASE = `${API_BASE_URL}/api/v1`');
    expect(source).toContain("headers.set('X-Property-Slug', PROPERTY_SLUG)");
  });
});
