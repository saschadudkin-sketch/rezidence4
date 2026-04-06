#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let hasError = false;

function assertContains(path, needle, label) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(needle)) {
    console.error(`[architecture-governance] Missing ${label} in ${path}`);
    hasError = true;
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// A2: service contracts must be enforced centrally.
assertContains('src/services/providers/createServices.ts', 'assertServiceContracts', 'service contract assertion');
assertContains('src/services/providers/serviceContainer.ts', 'ServiceContainer', 'typed service container');

// A4: decomposition baseline for ChatView.
assertContains('src/chat/hooks/useChatSearch.ts', 'export function useChatSearch', 'chat search hook extraction');
assertContains('src/chat/hooks/useChatComposer.ts', 'export function useChatComposer', 'chat composer hook extraction');
assertContains('src/chat/hooks/useChatData.ts', 'export function useChatData', 'chat data hook extraction');
assertContains('src/chat/ChatMessageList.tsx', 'export function ChatMessageList', 'chat message list extraction');
assertContains('src/chat/ChatView.tsx', 'ChatMessageList', 'ChatView list composition');

// A5: state strategy guard — React Query must stay in hooks/views layer, not store.
const storeFiles = walk('src/store').filter(path => /\.(ts|tsx|js|jsx)$/.test(path));
for (const file of storeFiles) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('@tanstack/react-query')) {
    console.error(`[architecture-governance] React Query import is forbidden in store layer: ${file}`);
    hasError = true;
  }
}

// A6: data-plane ownership — forbid direct React Query usage for SSE-owned entities.
const sseOwnedQueryKeys = ['requests', 'chat', 'users', 'perms', 'templates', 'blacklist'];
const appFiles = walk('src').filter(path => /\.(ts|tsx|js|jsx)$/.test(path));
for (const file of appFiles) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('useQuery')) continue;
  for (const entity of sseOwnedQueryKeys) {
    const directKeyRegex = new RegExp(`queryKey\\s*:\\s*\\[\\s*['"\`]${entity}['"\`]`, 'm');
    if (directKeyRegex.test(text)) {
      console.error(`[architecture-governance] SSE-owned entity "${entity}" cannot use queryKey in ${file}. Use AppStore/SSE reducers.`);
      hasError = true;
    }
  }
}

if (hasError) {
  console.error('\n❌ Architecture governance checks failed.');
  process.exit(1);
}

console.log('✅ Architecture governance checks passed.');
