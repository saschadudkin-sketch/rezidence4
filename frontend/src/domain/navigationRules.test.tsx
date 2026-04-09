import { resolveTabGuard } from './navigationRules';

describe('navigation rules engine', () => {
  const knownTabs = new Set(['passes', 'chat', 'users']);

  test('allows accessible tab', () => {
    const result = resolveTabGuard({
      role: 'owner',
      requestedTab: 'passes',
      defaultTab: 'passes',
      knownTabs,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('redirects forbidden tab with forbidden reason', () => {
    const result = resolveTabGuard({
      role: 'owner',
      requestedTab: 'users',
      defaultTab: 'passes',
      knownTabs,
    });

    expect(result.allowed).toBe(false);
    expect(result.targetTab).toBe('passes');
    expect(result.reason).toBe('forbidden');
  });

  test('redirects unknown tab with invalid reason', () => {
    const result = resolveTabGuard({
      role: 'owner',
      requestedTab: 'unknown',
      defaultTab: 'passes',
      knownTabs,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('invalid');
  });
});
