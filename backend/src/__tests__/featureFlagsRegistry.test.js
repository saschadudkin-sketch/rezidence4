'use strict';

/**
 * featureFlagsRegistry.test.js — Integrity checks for the feature-flag
 * registry.  The registry is the single source of truth consumed by the
 * admin UI, so drift between registry entries, the frontend key list, and
 * the public schema is load-bearing: silent drift yields toggles that do
 * nothing or admin screens that hide a feature forever.
 */

const { describe, test, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const {
  FEATURE_FLAGS,
  CATEGORIES,
  resolveFlags,
  getPublicSchema,
  getFlagKeys,
} = require('../config/featureFlags');

describe('feature flag registry', () => {
  test('every flag references a category defined in CATEGORIES', () => {
    for (const [, meta] of Object.entries(FEATURE_FLAGS)) {
      expect(CATEGORIES[meta.category]).toBeDefined();
    }
  });

  test('every flag has label + description (non-empty)', () => {
    for (const [, meta] of Object.entries(FEATURE_FLAGS)) {
      expect(typeof meta.label).toBe('string');
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  test('getPublicSchema returns every registered flag with stable shape', () => {
    const { flags, categories } = getPublicSchema();
    expect(flags).toHaveLength(getFlagKeys().length);
    for (const entry of flags) {
      expect(entry).toEqual(expect.objectContaining({
        key: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        category: expect.any(String),
        default: expect.any(Boolean),
        locked: expect.any(Boolean),
      }));
    }
    for (const cat of categories) {
      expect(cat).toEqual({ key: expect.any(String), label: expect.any(String), order: expect.any(Number) });
    }
  });

  test('getPublicSchema categories are sorted by order', () => {
    const { categories } = getPublicSchema();
    for (let i = 1; i < categories.length; i += 1) {
      expect(categories[i].order).toBeGreaterThanOrEqual(categories[i - 1].order);
    }
  });

  test('resolveFlags falls back to defaults for missing keys', () => {
    const out = resolveFlags({ qr_pass: true });
    expect(out.qr_pass).toBe(true);
    for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
      if (key === 'qr_pass') continue;
      expect(out[key]).toBe(meta.default);
    }
  });

  test('resolveFlags ignores stored overrides for locked flags', () => {
    // DB drift (someone wrote chat=false directly): resolver refuses to honor
    // it, because locked flags always return their registry default.
    const out = resolveFlags({ chat: false });
    expect(out.chat).toBe(true);
  });

  test('resolveFlags tolerates null / non-object input', () => {
    expect(resolveFlags(null).chat).toBe(true);
    expect(resolveFlags(undefined).chat).toBe(true);
    expect(resolveFlags('nope').chat).toBe(true);
  });
});

describe('backend ↔ frontend key contract', () => {
  // The frontend hardcodes its flag keys as a TypeScript `as const` tuple so
  // the `FeatureFlags` type can stay narrow at call sites.  If backend adds a
  // flag but forgets to update the frontend tuple, the two lists diverge and
  // the admin screen silently stops rendering the new toggle.  Parse the
  // frontend file and assert equality here.
  const frontendPath = path.resolve(__dirname, '../../../frontend/src/contexts/FeatureFlagsContext.tsx');

  test('frontend FEATURE_KEYS matches backend registry keys (same set, same order)', () => {
    if (!fs.existsSync(frontendPath)) {
      // Backend-only installs (test-only images, CI stages that strip the
      // frontend) should not fail this test.
      return;
    }
    const src = fs.readFileSync(frontendPath, 'utf8');
    const match = src.match(/FEATURE_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
    expect(match).toBeTruthy();
    const frontendKeys = match[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(frontendKeys).toEqual(getFlagKeys());
  });
});
