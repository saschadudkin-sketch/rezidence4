#!/usr/bin/env node
import { readFileSync } from 'fs';

const files = [
  'src/ui/Modals.tsx',
  'src/requests/CreateModal.tsx',
  'src/requests/EditRequestModal.tsx',
  'src/requests/PassQRModal.tsx',
  'src/requests/CarSearchModal.tsx',
  'src/requests/ScanQRModal.tsx',
];

let hasError = false;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('useModalAccessibility')) {
    console.error(`[modal-a11y] ${file} must use useModalAccessibility`);
    hasError = true;
  }
  if (!text.includes('role="dialog"') || !text.includes('aria-modal="true"')) {
    console.error(`[modal-a11y] ${file} must declare role="dialog" and aria-modal="true"`);
    hasError = true;
  }
}

const chatView = readFileSync('src/chat/ChatView.tsx', 'utf8');
if (!chatView.includes('<ConfirmDialog')) {
  console.error('[modal-a11y] ChatView must use ConfirmDialog for destructive confirmation modal');
  hasError = true;
}

if (hasError) {
  console.error('\n❌ Modal a11y contract check failed.');
  process.exit(1);
}

console.log('✅ Modal a11y contract check passed.');
