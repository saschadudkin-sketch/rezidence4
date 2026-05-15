'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');

function readScript(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectPowerShellExclude(script, excludedPath) {
  expect(script).toContain(`'--exclude', '${excludedPath}'`);
}

describe('security scan scripts', () => {
  test('PowerShell Semgrep wrapper excludes generated and local worktree paths', () => {
    const ps1 = readScript('scripts/run-semgrep.ps1');
    const cjs = readScript('scripts/run-semgrep.cjs');
    const expectedExcludes = [
      '.git',
      '.claude',
      'artifacts',
      'test-results',
      'playwright-report',
    ];

    for (const excludedPath of expectedExcludes) {
      expectPowerShellExclude(ps1, excludedPath);
      expect(cjs).toContain(`'--exclude', '${excludedPath}'`);
    }
  });
});
