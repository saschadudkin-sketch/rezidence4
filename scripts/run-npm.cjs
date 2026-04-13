const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
const npmExecPath = process.env.npm_execpath;
const env = { ...process.env };
delete env.npm_execpath;

function getNpmCommand() {
  if (process.platform === 'win32') {
    return {
      command: 'npm.cmd',
      prefixArgs: [],
      shell: true,
    };
  }

  if (npmExecPath?.endsWith('.js')) {
    return {
      command: process.execPath,
      prefixArgs: [npmExecPath],
      shell: false,
    };
  }

  if (npmExecPath) {
    return {
      command: npmExecPath,
      prefixArgs: [],
      shell: false,
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    prefixArgs: [],
    shell: process.platform === 'win32',
  };
}

const npm = getNpmCommand();
const result = spawnSync(npm.command, [...npm.prefixArgs, ...args], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: npm.shell,
});

if (result.error) {
  console.error(`[run-npm] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
