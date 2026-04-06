#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';

let hasError = false;

function assertFile(path) {
  if (!existsSync(path)) {
    console.error(`[visual-matrix] Missing required file: ${path}`);
    hasError = true;
  }
}

function assertContains(path, needle, label) {
  if (!existsSync(path)) {
    console.error(`[visual-matrix] Missing required file: ${path}`);
    hasError = true;
    return;
  }
  const text = readFileSync(path, 'utf8');
  if (!text.includes(needle)) {
    console.error(`[visual-matrix] Missing ${label} in ${path}`);
    hasError = true;
  }
}

assertFile('src/stories/StateBlock.stories.tsx');
assertContains('src/stories/StateBlock.stories.tsx', "options: ['empty', 'loading', 'error']", 'state matrix options');
assertFile('src/stories/SmartActionRail.stories.tsx');
assertContains('src/views/shell/NavigationShell.tsx', 'visualViewport', 'keyboard-aware viewport observer');
assertContains('src/styles/components/navigation.css', '--vk-offset', 'keyboard-safe offset token usage');

if (hasError) {
  console.error('\n❌ Visual/state matrix checks failed.');
  process.exit(1);
}

console.log('✅ Visual/state matrix checks passed.');
