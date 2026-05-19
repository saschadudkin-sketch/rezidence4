#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  path.join(root, 'backend', 'src', 'v1', 'routes'),
  path.join(root, 'backend', 'src', 'v1', 'services'),
];

const propertyOwnedTables = [
  'access_incidents',
  'access_overrides',
  'access_points',
  'access_policies',
  'access_requests',
  'access_zones',
  'announcements_v2',
  'buildings',
  'contractor_companies',
  'contractor_users',
  'documents_v2',
  'erp_provider_configs',
  'notification_log_v2',
  'notifications_outbox',
  'packages_v2',
  'passes',
  'residents',
  'skud_provider_configs',
  'staff_users',
  'units',
  'vehicles',
  'video_evidence_references',
  'visit_logs_v2',
];

const routeHelperGuards = [
  {
    file: path.join(root, 'backend', 'src', 'v1', 'routes', 'announcements.js'),
    helper: 'getById',
  },
  {
    file: path.join(root, 'backend', 'src', 'v1', 'routes', 'documents.js'),
    helper: 'getById',
  },
  {
    file: path.join(root, 'backend', 'src', 'v1', 'routes', 'packages.js'),
    helper: 'getById',
  },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function compactSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function isScopedSql(snippet) {
  return /\bproperty_id\s*=\s*\$\d+\b/i.test(snippet)
    || /\$\{\s*propertyPredicate\s*\}/.test(snippet)
    || /\$\{[^}]*propertyId[^}]*\?\s*['"`]\s*AND\s+property_id/i.test(snippet)
    || /\$\{[^}]*property_id[^}]*\}/i.test(snippet);
}

function isFullRowSelect(selectExpr) {
  return /^\s*\*/.test(selectExpr)
    || /\$\{[^}]*\b(?:COLS|COLUMNS)\b[^}]*\}/.test(selectExpr);
}

function auditSqlText(file, source) {
  const findings = [];
  const tablePattern = propertyOwnedTables.join('|');
  const re = new RegExp(
    String.raw`SELECT\s+([\s\S]{1,180}?)\s+FROM\s+(${tablePattern})\s+WHERE\s+id\s*=\s*\$1([\s\S]{0,220})`,
    'gi',
  );

  for (const match of source.matchAll(re)) {
    const [raw, selectExpr, table, tail] = match;
    const snippet = `${raw}${tail}`;
    if (!isFullRowSelect(selectExpr)) continue;
    if (isScopedSql(snippet)) continue;

    findings.push({
      file,
      line: lineOf(source, match.index),
      message: `full-row ${table} id lookup is missing property_id scope`,
      sql: compactSql(snippet).slice(0, 220),
    });
  }
  return findings;
}

function auditMutationText(file, source) {
  const findings = [];
  const tablePattern = propertyOwnedTables.join('|');
  const re = new RegExp(
    String.raw`\b(UPDATE|DELETE\s+FROM)\s+(${tablePattern})\b([\s\S]{0,360}?)\bWHERE\s+id\s*=\s*\$1([\s\S]{0,220})`,
    'gi',
  );

  for (const match of source.matchAll(re)) {
    const [raw, op, table, middle, tail] = match;
    const snippet = `${raw}${middle}${tail}`;
    if (isScopedSql(snippet)) continue;

    findings.push({
      file,
      line: lineOf(source, match.index),
      message: `${op.toUpperCase()} ${table} id mutation is missing property_id scope`,
      sql: compactSql(snippet).slice(0, 220),
    });
  }
  return findings;
}

function auditRouteHelperCalls(source, guard) {
  const findings = [];
  const callRe = new RegExp(String.raw`\b${guard.helper}\s*\(\s*pool\s*,\s*req\.params\.id\s*\)`, 'g');
  for (const match of source.matchAll(callRe)) {
    findings.push({
      file: guard.file,
      line: lineOf(source, match.index),
      message: `${guard.helper}(pool, req.params.id) route call is missing { propertyId }`,
      sql: match[0],
    });
  }
  return findings;
}

const files = scanRoots.flatMap(walk);
const findings = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  findings.push(...auditSqlText(file, source));
  findings.push(...auditMutationText(file, source));
}
for (const guard of routeHelperGuards) {
  if (!fs.existsSync(guard.file)) continue;
  findings.push(...auditRouteHelperCalls(fs.readFileSync(guard.file, 'utf8'), guard));
}

if (findings.length) {
  console.error('[backend-v1-property-scope-audit] unsafe property-scope reads found:');
  for (const finding of findings) {
    console.error(`- ${path.relative(root, finding.file)}:${finding.line} ${finding.message}`);
    console.error(`  ${finding.sql}`);
  }
  process.exit(1);
}

console.log('[backend-v1-property-scope-audit] OK');
