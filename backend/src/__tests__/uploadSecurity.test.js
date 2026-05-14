'use strict';

const { createSignedUploadUrl, verifySignedUploadQuery } = require('../services/uploadSecurity');

describe('uploadSecurity signed URL', () => {
  test('creates verifiable signature', () => {
    const url = createSignedUploadUrl('photo_1.webp', 'http://localhost:3001');
    const parsed = new URL(url);
    const ok = verifySignedUploadQuery('photo_1.webp', {
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
    });
    expect(ok).toBe(true);
  });

  test('rejects wrong filename', () => {
    const url = createSignedUploadUrl('photo_1.webp', 'http://localhost:3001');
    const parsed = new URL(url);
    const ok = verifySignedUploadQuery('photo_2.webp', {
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
    });
    expect(ok).toBe(false);
  });

  test('binds tenant slug into signed URL signature when provided', () => {
    const url = createSignedUploadUrl('photo_1.webp', 'http://localhost:3001', { propertySlug: 'alpha' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('ps')).toBe('alpha');

    expect(verifySignedUploadQuery('photo_1.webp', {
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
      ps: 'alpha',
    })).toBe(true);
    expect(verifySignedUploadQuery('photo_1.webp', {
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
      ps: 'beta',
    })).toBe(false);
  });
});
