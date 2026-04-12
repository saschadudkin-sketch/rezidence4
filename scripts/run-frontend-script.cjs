const { spawnSync } = require('node:child_process');
const path = require('node:path');

const [, , scriptName, ...scriptArgs] = process.argv;

if (!scriptName) {
  console.error('Usage: node scripts/run-frontend-script.cjs <npm-script>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const npmCli = process.env.npm_execpath;

const env = { ...process.env };
if (scriptName === 'build') {
  env.VITE_API_URL = env.VITE_API_URL || 'http://localhost:3001';
  env.VITE_RUNTIME_MODE = env.VITE_RUNTIME_MODE || 'live';
}

const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forwardedArgs = scriptArgs.length > 0 ? ['--', ...scriptArgs] : [];
const args = npmCli
  ? [npmCli, 'run', scriptName, ...forwardedArgs]
  : ['run', scriptName, ...forwardedArgs];

const result = spawnSync(command, args, {
  cwd: frontendDir,
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
