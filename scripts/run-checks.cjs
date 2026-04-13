const { spawnSync } = require('node:child_process');
const path = require('node:path');

const profile = process.argv[2] || 'verify';
const rootDir = path.resolve(__dirname, '..');

const profiles = {
  test: [
    { label: 'backend tests', cwd: path.join(rootDir, 'backend'), args: ['./node_modules/jest/bin/jest.js', '--runInBand'] },
    { label: 'frontend tests', cwd: rootDir, args: ['scripts/run-frontend-script.cjs', 'test'] },
  ],
  verify: [
    { label: 'backend tests', cwd: path.join(rootDir, 'backend'), args: ['./node_modules/jest/bin/jest.js', '--runInBand'] },
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

for (const { label, cwd, args } of steps) {
  console.log(`\n[run-checks] ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  });

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
