import { createRequire } from 'node:module';

interface CoverageResult {
  counts: {
    v1ClientCalls: number;
    directUrlCalls: number;
    contractCalls: number;
  };
  genericResponses: string[];
  missingOperations: string[];
  ok: boolean;
  thresholdFailures: string[];
}

const require = createRequire(import.meta.url);
const { collectCoverage } = require('../../../../scripts/frontend-v1-contract-coverage.cjs') as {
  collectCoverage: () => CoverageResult;
};

describe('frontend v1 API contract coverage', () => {
  test('keeps every frontend v1 call mapped to a typed OpenAPI operation', () => {
    const result = collectCoverage();

    expect(result.counts.v1ClientCalls).toBeGreaterThanOrEqual(160);
    expect(result.counts.directUrlCalls).toBeGreaterThanOrEqual(3);
    expect(result.missingOperations).toEqual([]);
    expect(result.genericResponses).toEqual([]);
    expect(result.thresholdFailures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
