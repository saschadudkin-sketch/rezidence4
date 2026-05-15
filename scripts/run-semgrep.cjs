#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

if (process.platform === 'win32') {
  const powershell = process.env.POWERSHELL_EXE || 'powershell';
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repoRoot, 'scripts', 'run-semgrep.ps1'),
  ], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });
  process.exit(result.status ?? 1);
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(probe, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

function resolveSemgrep() {
  if (process.env.SEMGREP_EXE && fs.existsSync(process.env.SEMGREP_EXE)) return process.env.SEMGREP_EXE;
  if (commandExists('semgrep')) return 'semgrep';
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const pythonRoot = path.join(appData, 'Python');
    if (!fs.existsSync(pythonRoot)) return null;
    for (const versionDir of fs.readdirSync(pythonRoot)) {
      const candidate = path.join(pythonRoot, versionDir, 'Scripts', 'semgrep.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const semgrep = resolveSemgrep();
if (!semgrep) {
  console.error('[security:semgrep] semgrep was not found. Set SEMGREP_EXE or install semgrep into PATH.');
  process.exit(1);
}

const env = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};

const semgrepDir = path.dirname(semgrep);
if (semgrep !== 'semgrep') {
  env.PATH = `${semgrepDir}${path.delimiter}${env.PATH || ''}`;
}

const result = spawnSync(semgrep, [
  'scan',
  '--config', 'p/ci',
  '--error',
  '--exclude', 'node_modules',
  '--exclude', '.git',
  '--exclude', '.claude',
  '--exclude', 'artifacts',
  '--exclude', 'test-results',
  '--exclude', 'playwright-report',
  '--exclude', 'frontend/node_modules',
  '--exclude', 'backend/node_modules',
  '--exclude', 'frontend/dist',
  '--exclude', 'frontend/storybook-static',
  '--exclude', 'backend/coverage',
  '--exclude', 'backend/src/__tests__',
  repoRoot,
], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
