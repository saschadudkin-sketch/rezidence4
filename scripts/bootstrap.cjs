const { spawnSync } = require('node:child_process');

const npmExecPath = process.env.npm_execpath;

function run(args) {
  const command = npmExecPath?.endsWith('.js')
    ? process.execPath
    : npmExecPath || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = npmExecPath?.endsWith('.js') ? [npmExecPath, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: !npmExecPath && process.platform === 'win32',
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
