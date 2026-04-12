const { spawn } = require('node:child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const processes = [
  {
    name: 'backend',
    child: spawn(npmCmd, ['--prefix', 'backend', 'run', 'dev'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    }),
  },
  {
    name: 'frontend',
    child: spawn(npmCmd, ['--prefix', 'frontend', 'run', 'dev'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    }),
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
