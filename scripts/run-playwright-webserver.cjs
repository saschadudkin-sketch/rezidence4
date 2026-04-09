const { spawn } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const viteEntry = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(
  process.execPath,
  [viteEntry, '--host', '127.0.0.1', '--port', '3000'],
  {
    cwd: frontendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_RUNTIME_MODE: process.env.VITE_RUNTIME_MODE || 'demo',
      VITE_ENABLE_DEMO: process.env.VITE_ENABLE_DEMO || 'true',
    },
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
});
