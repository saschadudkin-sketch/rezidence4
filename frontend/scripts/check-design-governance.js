#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'docs/design-system-governance.md');
if (!fs.existsSync(filePath)) {
  console.error('❌ Missing docs/design-system-governance.md');
  process.exit(1);
}

const text = fs.readFileSync(filePath, 'utf8');
const requiredMarkers = [
  '## Component Inventory (core UI)',
  '## Hard design rules',
  '## Review checklist (release gate)',
  'PageActionBar',
  'NavigationShell',
  'StateBlock',
];

const missing = requiredMarkers.filter(marker => !text.includes(marker));
if (missing.length) {
  console.error('❌ Design governance document is incomplete.');
  missing.forEach(marker => console.error(`   - Missing marker: ${marker}`));
  process.exit(1);
}

console.log('✅ Design governance document is present and complete.');
