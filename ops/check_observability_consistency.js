#!/usr/bin/env node
'use strict';

/**
 * Проверяет базовую согласованность observability артефактов:
 * 1) Каждое alert-правило из ops/alerts/*.rules.yml должно быть упомянуто в docs/runbooks/alerts.md
 * 2) docs/observability.md должен ссылаться на rule files и runbook
 *
 * Запуск:
 *   node ops/check_observability_consistency.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const alertsDir = path.join(repoRoot, 'ops', 'alerts');
const runbookPath = path.join(repoRoot, 'docs', 'runbooks', 'alerts.md');
const observabilityPath = path.join(repoRoot, 'docs', 'observability.md');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listAlertRuleFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.rules.yml')).sort();
}

function extractAlertNames(yamlText) {
  const names = [];
  const re = /^\s*-\s*alert:\s*([A-Za-z0-9_:-]+)\s*$/gm;
  let m;
  while ((m = re.exec(yamlText)) !== null) names.push(m[1]);
  return names;
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function main() {
  const ruleFiles = listAlertRuleFiles(alertsDir);
  if (ruleFiles.length === 0) {
    fail('No alert rule files found in ops/alerts');
    return;
  }

  const runbookText = readText(runbookPath);
  const observabilityText = readText(observabilityPath);

  const alertNames = [];
  for (const file of ruleFiles) {
    const filePath = path.join(alertsDir, file);
    const names = extractAlertNames(readText(filePath));
    if (names.length === 0) {
      fail(`No alerts found in ${path.relative(repoRoot, filePath)}`);
      continue;
    }
    alertNames.push(...names);
  }

  for (const alertName of alertNames) {
    if (!runbookText.includes(alertName)) {
      fail(`Runbook missing alert section/reference for "${alertName}"`);
    } else {
      ok(`Runbook references alert "${alertName}"`);
    }
  }

  for (const ruleFile of ruleFiles) {
    const relPath = `ops/alerts/${ruleFile}`;
    if (!observabilityText.includes(relPath)) {
      fail(`docs/observability.md missing reference to ${relPath}`);
    } else {
      ok(`docs/observability.md references ${relPath}`);
    }
  }

  const runbookRelPath = 'docs/runbooks/alerts.md';
  if (!observabilityText.includes(runbookRelPath)) {
    fail(`docs/observability.md missing reference to ${runbookRelPath}`);
  } else {
    ok(`docs/observability.md references ${runbookRelPath}`);
  }

  if (process.exitCode && process.exitCode !== 0) {
    console.error('\nObservability consistency check failed.');
    return;
  }

  console.log('\nObservability consistency check passed.');
}

main();
