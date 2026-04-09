const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
const args = ['install'];

if (process.platform === 'linux') args.push('--with-deps');
args.push('chromium');

const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
