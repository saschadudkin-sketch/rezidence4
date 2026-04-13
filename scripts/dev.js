const { spawn } = require('node:child_process');

const npmExecPath = process.env.npm_execpath;

function createNpmProcess(args) {
  const command = npmExecPath?.endsWith('.js')
    ? process.execPath
    : npmExecPath || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = npmExecPath?.endsWith('.js') ? [npmExecPath, ...args] : args;

  return spawn(command, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: !npmExecPath && process.platform === 'win32',
  });
}

const processes = [
  {
    name: 'backend',
    child: createNpmProcess(['--prefix', 'backend', 'run', 'dev']),
  },
  {
    name: 'frontend',
    child: createNpmProcess(['--prefix', 'frontend', 'run', 'dev']),
  },
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const processInfo of processes) {
    if (!processInfo.child.killed) {
      processInfo.child.kill('SIGINT');
    }
  }

  setTimeout(() => process.exit(code), 300);
}

for (const processInfo of processes) {
  processInfo.child.on('exit', (code) => {
    if (shuttingDown) return;
    const exitCode = typeof code === 'number' ? code : 1;
    console.error(`[dev] ${processInfo.name} exited with code ${exitCode}`);
    shutdown(exitCode);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
