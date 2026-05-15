const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { buildE2EEnv } = require('./e2e-env.cjs');

const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const backendDir = path.join(repoRoot, 'backend');
const viteEntry = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const backendEntry = path.join(backendDir, 'src', 'index.js');
const seedV1AccessEntry = path.join(backendDir, 'src', 'e2e', 'seedV1Access.js');
const tenantOpsPreflightEntry = path.join(repoRoot, 'scripts', 'tenant-ops-preflight.cjs');
const backendMode = process.env.E2E_BACKEND_MODE === '1' || process.env.E2E_V1_ACCESS === '1';
const e2eEnv = buildE2EEnv(process.env);
const backendPort = e2eEnv.E2E_BACKEND_PORT || e2eEnv.PORT || '3001';
const children = [];

function startChild(command, args, options, exitParentOnClean = false) {
  const child = spawn(command, args, options);
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code && code !== 0) process.exit(code);
    if (exitParentOnClean) process.exit(code ?? 0);
  });
  return child;
}

function runSeedV1Access() {
  if (process.env.E2E_V1_ACCESS !== '1' || process.env.E2E_SEED_V1_ACCESS === '0') return;

  const preflight = spawnSync(process.execPath, [tenantOpsPreflightEntry, '--e2e-access'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: e2eEnv,
  });
  if (preflight.status !== 0) {
    process.exit(preflight.status ?? 1);
  }

  const result = spawnSync(process.execPath, [seedV1AccessEntry], {
    cwd: backendDir,
    stdio: 'inherit',
    env: e2eEnv,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (backendMode && process.env.E2E_START_BACKEND === '1') {
  runSeedV1Access();

  startChild(process.execPath, [backendEntry], {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...e2eEnv,
      NODE_ENV: e2eEnv.NODE_ENV || 'test',
      PORT: backendPort,
      FRONTEND_URL: e2eEnv.FRONTEND_URL,
      E2E_DISABLE_RATE_LIMITS: e2eEnv.E2E_DISABLE_RATE_LIMITS,
    },
  });
}

startChild(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '3000'], {
  cwd: frontendDir,
  stdio: 'inherit',
  env: {
    ...e2eEnv,
    VITE_RUNTIME_MODE: e2eEnv.VITE_RUNTIME_MODE || (backendMode ? 'live' : 'demo'),
    VITE_ENABLE_DEMO: e2eEnv.VITE_ENABLE_DEMO || (backendMode ? 'false' : 'true'),
    VITE_API_URL: e2eEnv.VITE_API_URL || (backendMode ? `http://127.0.0.1:${backendPort}` : ''),
    VITE_DEV_API_PROXY: e2eEnv.VITE_DEV_API_PROXY || (backendMode ? `http://127.0.0.1:${backendPort}` : ''),
  },
}, true);

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    for (const child of children) {
      if (!child.killed) child.kill(sig);
    }
  });
});
