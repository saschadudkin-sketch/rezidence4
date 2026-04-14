module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    'src/routes/auth.js',
    'src/routes/requests.js',
    'src/middleware/authorize.js',
    'src/middleware/idempotency.js',
  ],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
  maxWorkers: 1,
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/auth.test.js',
    '**/__tests__/requests.test.js',
    '**/__tests__/authorize.test.js',
    '**/__tests__/idempotency.test.js',
  ],
  testEnvironment: 'node',
};
