#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(probe, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

function resolveGitleaks() {
  if (process.env.GITLEAKS_EXE && fs.existsSync(process.env.GITLEAKS_EXE)) return process.env.GITLEAKS_EXE;
  if (commandExists('gitleaks')) return 'gitleaks';
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\tmp\\gitleaks\\gitleaks.exe',
      path.join(process.env.USERPROFILE || '', '.local', 'bin', 'gitleaks.exe'),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }
  return null;
}

const gitleaks = resolveGitleaks();
if (!gitleaks) {
  console.error('[security:gitleaks] gitleaks was not found. Set GITLEAKS_EXE or install gitleaks into PATH.');
  process.exit(1);
}

const reportPath = path.join(os.tmpdir(), `gitleaks-report-${process.pid}.json`);
const configPath = path.join(repoRoot, '.gitleaks.toml');
const args = [
  'detect',
  '--source', repoRoot,
  '--redact',
  '--no-banner',
  '--exit-code', '1',
  '--log-level', process.env.GITLEAKS_LOG_LEVEL || 'warn',
  '--report-format', 'json',
  '--report-path', reportPath,
];
if (fs.existsSync(configPath)) {
  args.push('--config', configPath);
}

const result = spawnSync(gitleaks, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
});

if ((result.status ?? 1) !== 0 && fs.existsSync(reportPath)) {
  try {
    const findings = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (Array.isArray(findings) && findings.length > 0) {
      console.error('[security:gitleaks] redacted findings:');
      for (const finding of findings) {
        console.error(JSON.stringify({
          rule: finding.RuleID,
          file: finding.File,
          line: finding.StartLine,
          fingerprint: finding.Fingerprint,
          description: finding.Description,
        }));
      }
    }
  } catch (error) {
    console.error(`[security:gitleaks] failed to read report: ${error.message}`);
  }
}

try {
  fs.rmSync(reportPath, { force: true });
} catch {
  // Best effort cleanup only.
}

process.exit(result.status ?? 1);
