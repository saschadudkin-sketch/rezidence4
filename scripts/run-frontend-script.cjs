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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: frontendDir,
    env,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

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
