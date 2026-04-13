const { spawnSync } = require('node:child_process');

const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) {
  console.error('[bootstrap] npm_execpath is not set. Run this script through npm: npm run bootstrap');
  process.exit(1);
}

function run(args) {
  const command = npmExecPath.endsWith('.js') ? process.execPath : npmExecPath;
  const commandArgs = npmExecPath.endsWith('.js') ? [npmExecPath, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(`[bootstrap] failed to start npm ${args.join(' ')}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(['ci', '--ignore-scripts']);
run(['--prefix', 'backend', 'ci']);
run(['--prefix', 'frontend', 'ci']);
