import '@testing-library/jest-dom';
import { vi } from 'vitest';

if (!globalThis.jest) {
  globalThis.jest = vi;
}

if (!globalThis.vi) {
  globalThis.vi = vi;
}
