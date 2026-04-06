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
});
