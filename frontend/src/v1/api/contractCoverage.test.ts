import { createRequire } from 'node:module';

interface CoverageResult {
  counts: {
    v1ClientCalls: number;
    directUrlCalls: number;
    contractCalls: number;
  };
  directUrlCalls: Array<{
    file: string;
    method: string;
    path: string;
    reason: string | null;
  }>;
  directUrlAllowlistFailures: string[];
  genericResponses: string[];
  missingOperations: string[];
  ok: boolean;
  thresholdFailures: string[];
}

interface AuditOperation {
  method: string;
  path: string;
  reason?: string;
}

interface AuditResult {
  totals: {
    productGapOperations: number;
    intentionallyNoFrontendClientOperations: number;
  };
  productGapBuckets: Array<{ operations: AuditOperation[] }>;
  ignoredBuckets: Array<{ operations: AuditOperation[] }>;
}

const require = createRequire(import.meta.url);
const { audit, collectCoverage } = require('../../../../scripts/frontend-v1-contract-coverage.cjs') as {
  audit: () => AuditResult;
  collectCoverage: () => CoverageResult;
};

describe('frontend v1 API contract coverage', () => {
  test('keeps every frontend v1 call mapped to a typed OpenAPI operation', () => {
    const result = collectCoverage();
    const directUrlKeys = result.directUrlCalls
      .map((call) => `${call.file} ${call.method} ${call.path}`)
      .sort();

    expect(result.counts.v1ClientCalls).toBeGreaterThanOrEqual(160);
    expect(result.counts.directUrlCalls).toBe(3);
    expect(directUrlKeys).toEqual([
      'src/v1/pages/GisOssReadinessPage.tsx get /gis-oss/export-packages/{param}/artifact',
      'src/v1/pages/OnboardingAdminPage.tsx get /units/import/template',
      'src/views/public/GuestPassPage.tsx get /public/pass/{param}',
    ].sort());
    expect(result.directUrlCalls.every((call) => Boolean(call.reason))).toBe(true);
    expect(result.directUrlAllowlistFailures).toEqual([]);
    expect(result.missingOperations).toEqual([]);
    expect(result.genericResponses).toEqual([]);
    expect(result.thresholdFailures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('keeps backend operations without frontend clients either covered or explicitly justified', () => {
    const result = audit();
    const ignoredOperations = result.ignoredBuckets.flatMap((bucket) => bucket.operations);

    expect(result.totals.productGapOperations).toBe(0);
    expect(result.productGapBuckets).toEqual([]);
    expect(result.totals.intentionallyNoFrontendClientOperations).toBe(ignoredOperations.length);
    expect(ignoredOperations.length).toBeGreaterThan(0);
    expect(ignoredOperations.every((operation) => Boolean(operation.reason))).toBe(true);
  });
});
