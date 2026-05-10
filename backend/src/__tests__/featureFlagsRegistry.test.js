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
  PACKAGE_PLANS,
  resolveFlags,
  getPublicSchema,
  getFlagKeys,
  getPlanKeys,
  normalizePlan,
  isFlagAllowedForPlan,
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
    const { flags, categories, plans } = getPublicSchema();
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
    expect(plans).toHaveLength(getPlanKeys().length);
    for (const plan of plans) {
      expect(plan).toEqual(expect.objectContaining({
        key: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        flags: expect.any(Array),
      }));
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

  test('package plan registry uses canonical packaging ids', () => {
    expect(getPlanKeys()).toEqual(['core_access', 'operations', 'portfolio', 'enterprise']);
    for (const key of getPlanKeys()) {
      expect(PACKAGE_PLANS[key]).toEqual(expect.objectContaining({
        label: expect.any(String),
        description: expect.any(String),
      }));
    }
  });

  test('normalizePlan maps legacy tariff ids to canonical packages', () => {
    expect(normalizePlan('standard')).toBe('core_access');
    expect(normalizePlan('core')).toBe('core_access');
    expect(normalizePlan('premium')).toBe('operations');
    expect(normalizePlan('pro')).toBe('operations');
    expect(normalizePlan('portfolio')).toBe('portfolio');
  });

  test('resolveFlags applies package constraints when a plan is supplied', () => {
    expect(resolveFlags({ packages: true }, 'core_access').packages).toBe(false);
    expect(resolveFlags({ packages: true }, 'operations').packages).toBe(true);
    expect(resolveFlags({ webhooks: true }, 'operations').webhooks).toBe(false);
    expect(resolveFlags({ webhooks: true }, 'enterprise').webhooks).toBe(true);
  });

  test('package constraints expose explicit flag allowance checks', () => {
    expect(isFlagAllowedForPlan('packages', 'core_access')).toBe(false);
    expect(isFlagAllowedForPlan('packages', 'portfolio')).toBe(true);
    expect(isFlagAllowedForPlan('webhooks', 'portfolio')).toBe(false);
    expect(isFlagAllowedForPlan('webhooks', 'enterprise')).toBe(true);
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
