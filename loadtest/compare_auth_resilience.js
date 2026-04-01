#!/usr/bin/env node
'use strict';

/**
 * Сравнивает текущий k6 отчёт auth_resilience с baseline и валит процесс
 * при существенной деградации.
 *
 * ENV:
 *   BASELINE_FILE (default: loadtest/baselines/auth_resilience_baseline.json)
 *   CURRENT_FILE  (default: loadtest/auth_resilience_results.json)
 *   MAX_P95_INCREASE_PCT (default: 15)
 *   MAX_P99_INCREASE_PCT (default: 20)
 *   MAX_ERROR_RATE_ABS   (default: 0.01)
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const baselineFile = path.resolve(repoRoot, process.env.BASELINE_FILE || 'loadtest/baselines/auth_resilience_baseline.json');
const currentFile = path.resolve(repoRoot, process.env.CURRENT_FILE || 'loadtest/auth_resilience_results.json');

const maxP95IncreasePct = Number(process.env.MAX_P95_INCREASE_PCT || 15);
const maxP99IncreasePct = Number(process.env.MAX_P99_INCREASE_PCT || 20);
const maxErrorRateAbs = Number(process.env.MAX_ERROR_RATE_ABS || 0.01);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pickMetric(report, metricName, key) {
  return report?.metrics?.[metricName]?.values?.[key];
}

function asNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
}

function pctDelta(base, current) {
  if (base === 0) return current === 0 ? 0 : 100;
  return ((current - base) / base) * 100;
}

function main() {
  if (!fs.existsSync(baselineFile)) {
    throw new Error(`Baseline file not found: ${baselineFile}`);
  }
  if (!fs.existsSync(currentFile)) {
    throw new Error(`Current report file not found: ${currentFile}`);
  }

  const baseline = readJson(baselineFile);
  const current = readJson(currentFile);

  const bP95 = asNumber(pickMetric(baseline, 'auth_me_latency', 'p(95)'), 'baseline auth_me_latency p(95)');
  const bP99 = asNumber(pickMetric(baseline, 'auth_me_latency', 'p(99)'), 'baseline auth_me_latency p(99)');
  const cP95 = asNumber(pickMetric(current, 'auth_me_latency', 'p(95)'), 'current auth_me_latency p(95)');
  const cP99 = asNumber(pickMetric(current, 'auth_me_latency', 'p(99)'), 'current auth_me_latency p(99)');
  const cErrorRate = asNumber(pickMetric(current, 'auth_errors', 'rate'), 'current auth_errors rate');

  const dP95 = pctDelta(bP95, cP95);
  const dP99 = pctDelta(bP99, cP99);

  console.log(`baseline p95=${bP95.toFixed(1)}ms, current p95=${cP95.toFixed(1)}ms, delta=${dP95.toFixed(1)}%`);
  console.log(`baseline p99=${bP99.toFixed(1)}ms, current p99=${cP99.toFixed(1)}ms, delta=${dP99.toFixed(1)}%`);
  console.log(`current error rate=${cErrorRate.toFixed(4)} (limit ${maxErrorRateAbs})`);

  if (dP95 > maxP95IncreasePct) {
    fail(`p95 regression too high: ${dP95.toFixed(1)}% > ${maxP95IncreasePct}%`);
  }
  if (dP99 > maxP99IncreasePct) {
    fail(`p99 regression too high: ${dP99.toFixed(1)}% > ${maxP99IncreasePct}%`);
  }
  if (cErrorRate > maxErrorRateAbs) {
    fail(`error rate too high: ${cErrorRate.toFixed(4)} > ${maxErrorRateAbs}`);
  }

  if (!process.exitCode) {
    console.log('✅ Auth resilience report is within baseline thresholds.');
  }
}

main();
