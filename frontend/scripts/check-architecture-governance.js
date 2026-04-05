#!/usr/bin/env node
import { readFileSync } from 'fs';

let hasError = false;

function assertContains(path, needle, label) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(needle)) {
    console.error(`[architecture-governance] Missing ${label} in ${path}`);
    hasError = true;
  }
}

// A2: service contracts must be enforced centrally.
assertContains('src/services/providers/createServices.ts', 'assertServiceContracts', 'service contract assertion');
assertContains('src/services/providers/serviceContainer.ts', 'ServiceContainer', 'typed service container');

// A4: decomposition baseline for ChatView (at least extracted hooks module must exist).
assertContains('src/chat/hooks/useChatSearch.ts', 'export function useChatSearch', 'chat search hook extraction');
assertContains('src/chat/hooks/useChatComposer.ts', 'export function useChatComposer', 'chat composer hook extraction');

if (hasError) {
  console.error('\n❌ Architecture governance checks failed.');
  process.exit(1);
}

console.log('✅ Architecture governance checks passed.');
