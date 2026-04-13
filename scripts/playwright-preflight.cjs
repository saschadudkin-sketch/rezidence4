const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const playwright = require('playwright');
const cli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');

function hasInstalledChromium() {
  try {
    const executablePath = playwright.chromium.executablePath();
    return Boolean(executablePath && fs.existsSync(executablePath));
  } catch {
    return false;
  }
}

if (hasInstalledChromium()) {
  console.log('Playwright Chromium is already installed.');
  process.exit(0);
}

const args = ['install'];

if (process.platform === 'linux') args.push('--with-deps');
args.push('chromium');

const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
