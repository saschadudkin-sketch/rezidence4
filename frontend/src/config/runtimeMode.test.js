describe('runtimeMode', () => {
  const loadRuntimeMode = async () => import('./runtimeMode.js');

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  test('defaults to demo when no env override is provided', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
    expect(runtimeMode.isDemoMode()).toBe(true);
    expect(runtimeMode.isLiveMode()).toBe(false);
  });

  test('uses VITE_RUNTIME_MODE when provided', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', 'live');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('falls back to VITE_MODE when VITE_RUNTIME_MODE is absent', async () => {
    vi.stubEnv('VITE_MODE', 'live');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('VITE_RUNTIME_MODE has priority over VITE_MODE', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', 'demo');
    vi.stubEnv('VITE_MODE', 'live');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('falls back to VITE_MODE when VITE_RUNTIME_MODE is invalid', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', 'staging');
    vi.stubEnv('VITE_MODE', 'live');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('normalizes env values (trim + lowercase)', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', '  LIVE  ');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('normalizes VITE_MODE when runtime mode is absent', async () => {
    vi.stubEnv('VITE_MODE', '  DeMo ');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('ignores unsupported mode values', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', 'staging');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('treats empty env values as unsupported and falls back to demo', async () => {
    vi.stubEnv('VITE_RUNTIME_MODE', '   ');
    vi.stubEnv('VITE_MODE', '');
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test.each([
    [{ runtime: 'live', app: 'demo' }, 'live'],
    [{ runtime: 'staging', app: 'demo' }, 'demo'],
    [{ runtime: '', app: 'live' }, 'live'],
    [{ runtime: undefined, app: '  LiVe ' }, 'live'],
  ])('resolves mode matrix %#', async (input, expectedMode) => {
    if (input.runtime !== undefined) vi.stubEnv('VITE_RUNTIME_MODE', input.runtime);
    if (input.app !== undefined) vi.stubEnv('VITE_MODE', input.app);
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe(expectedMode);
  });

  test('resolveRuntimeMode falls back to demo when both env vars absent', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode(
      { VITE_RUNTIME_MODE: '', VITE_MODE: '' },
    );
    expect(mode).toBe('demo');
  });

  test('normalizeMode returns empty string for unsupported values', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.normalizeMode('staging')).toBe('');
    expect(runtimeMode.normalizeMode(null)).toBe('');
  });
});
