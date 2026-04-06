import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

Object.defineProperty(window, 'scrollTo', {
  value: () => {},
  writable: true,
});

afterEach(() => {
  cleanup();
});
