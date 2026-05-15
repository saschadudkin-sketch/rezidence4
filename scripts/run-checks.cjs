const { spawnSync } = require('node:child_process');
const path = require('node:path');

const profile = process.argv[2] || 'verify';
const rootDir = path.resolve(__dirname, '..');

const profiles = {
  test: [
    { label: 'backend tests', cwd: path.join(rootDir, 'backend'), args: ['./node_modules/jest/bin/jest.js', '--runInBand', '--detectOpenHandles', '--openHandlesTimeout=1000'] },
    { label: 'frontend tests', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'test'] },
  ],
  verify: [
    { label: 'backend tests', cwd: path.join(rootDir, 'backend'), args: ['./node_modules/jest/bin/jest.js', '--runInBand', '--detectOpenHandles', '--openHandlesTimeout=1000'] },
    { label: 'frontend lint', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'lint'] },
    { label: 'frontend typecheck', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'typecheck:ci'] },
    { label: 'frontend tests', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'test'] },
    { label: 'frontend build', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'build'] },
  ],
};

const steps = profiles[profile];
if (!steps) {
  console.error(`[run-checks] Unknown profile: ${profile}`);
  process.exit(1);
}

const env = { ...process.env };
delete env.npm_execpath;

const RETRYABLE_INFRA_EXIT_CODES = new Set([3221225477]);
const RETRYABLE_INFRA_ERROR_CODES = new Set(['EBUSY', 'EAGAIN', 'EPERM']);

function shouldRetryInfraFailure(result, attempt) {
  if (attempt > 1) return false;
  if (result.error && RETRYABLE_INFRA_ERROR_CODES.has(result.error.code)) return true;
  const status = result.status ?? 1;
  return RETRYABLE_INFRA_EXIT_CODES.has(status);
}

for (const { label, cwd, args } of steps) {
  let result;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    console.log(`\n[run-checks] ${label}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`);
    result = spawnSync(process.execPath, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
    });

    if (shouldRetryInfraFailure(result, attempt)) {
      const reason = result.error
        ? `retryable infra error ${result.error.code}: ${result.error.message}`
        : `retryable infra exit code ${result.status}`;
      console.warn(`[run-checks] ${label} hit ${reason}; retrying once`);
      continue;
    }

    break;
  }

  if (result.error) {
    console.error(`[run-checks] ${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error(`[run-checks] ${label} failed with exit code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[run-checks] ${profile} passed`);
