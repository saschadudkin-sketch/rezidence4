const { spawnSync } = require('node:child_process');
const path = require('node:path');

const [, , scriptName, ...scriptArgs] = process.argv;

if (!scriptName) {
  console.error('Usage: node scripts/run-frontend-script.cjs <npm-script>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const env = { ...process.env };
delete env.npm_execpath;
if (scriptName === 'build') {
  env.VITE_API_URL = env.VITE_API_URL || 'http://localhost:3001';
  env.VITE_RUNTIME_MODE = env.VITE_RUNTIME_MODE || 'live';
}

const RETRYABLE_INFRA_EXIT_CODES = new Set([3221225477]);
const RETRYABLE_INFRA_ERROR_CODES = new Set(['EBUSY', 'EAGAIN', 'EPERM']);

function shouldRetryInfraFailure(result, attempt) {
  if (attempt > 1) return false;
  if (result.error && RETRYABLE_INFRA_ERROR_CODES.has(result.error.code)) return true;
  const status = result.status ?? 1;
  return RETRYABLE_INFRA_EXIT_CODES.has(status);
}

function run(command, args, options = {}) {
  let result;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    result = spawnSync(command, args, {
      cwd: frontendDir,
      env,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    if (shouldRetryInfraFailure(result, attempt)) {
      const reason = result.error
        ? `retryable infra error ${result.error.code}: ${result.error.message}`
        : `retryable infra exit code ${result.status}`;
      console.warn(`[run-frontend-script] ${scriptName} hit ${reason}; retrying once`);
      continue;
    }

    break;
  }

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNode(args) {
  run(process.execPath, args);
}

function runKnownScript() {
  switch (scriptName) {
    case 'lint':
      runNode([
        './node_modules/eslint/bin/eslint.js',
        'src/**/*.{ts,tsx,js,jsx}',
        '--ignore-pattern',
        'src/**/*.stories.*',
        ...scriptArgs,
      ]);
      return true;

    case 'typecheck:ci':
      runNode(['scripts/check-type-debt.js']);
      runNode(['./node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.typecheck.json']);
      return true;

    case 'test':
      runNode(['./node_modules/vitest/vitest.mjs', 'run', ...scriptArgs]);
      return true;

    case 'build':
      runNode(['scripts/verify-env.js', 'production']);
      runNode(['./node_modules/vite/bin/vite.js', 'build', ...scriptArgs]);
      return true;

    default:
      return false;
  }
}

if (runKnownScript()) {
  process.exit(0);
}

function getNpmCommand() {
  if (process.platform === 'win32') {
    return {
      command: 'npm.cmd',
      prefixArgs: [],
      shell: true,
    };
  }

  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return {
      command: process.execPath,
      prefixArgs: [npmCli],
      shell: false,
    };
  }

  return {
    command: 'npm',
    prefixArgs: [],
    shell: false,
  };
}

const npm = getNpmCommand();
const forwardedArgs = scriptArgs.length > 0 ? ['--', ...scriptArgs] : [];
const args = [...npm.prefixArgs, 'run', scriptName, ...forwardedArgs];

const result = spawnSync(npm.command, args, {
  cwd: frontendDir,
  env,
  stdio: 'inherit',
  shell: npm.shell,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
