describe('runtimeMode', () => {
  const originalEnv = process.env;
  const loadRuntimeMode = async () => import('./runtimeMode.js');

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REACT_APP_RUNTIME_MODE;
    delete process.env.REACT_APP_MODE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('defaults to demo when no env override is provided', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
    expect(runtimeMode.isDemoMode()).toBe(true);
    expect(runtimeMode.isLiveMode()).toBe(false);
  });

  test('uses REACT_APP_RUNTIME_MODE when provided', async () => {
    process.env.REACT_APP_RUNTIME_MODE = 'live';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('falls back to REACT_APP_MODE when REACT_APP_RUNTIME_MODE is absent', async () => {
    process.env.REACT_APP_MODE = 'live';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('REACT_APP_RUNTIME_MODE has priority over REACT_APP_MODE', async () => {
    process.env.REACT_APP_RUNTIME_MODE = 'demo';
    process.env.REACT_APP_MODE = 'live';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('falls back to REACT_APP_MODE when REACT_APP_RUNTIME_MODE is invalid', async () => {
    process.env.REACT_APP_RUNTIME_MODE = 'staging';
    process.env.REACT_APP_MODE = 'live';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('normalizes env values (trim + lowercase)', async () => {
    process.env.REACT_APP_RUNTIME_MODE = '  LIVE  ';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('live');
  });

  test('normalizes REACT_APP_MODE when runtime mode is absent', async () => {
    process.env.REACT_APP_MODE = '  DeMo ';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('ignores unsupported mode values', async () => {
    process.env.REACT_APP_RUNTIME_MODE = 'staging';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test('treats empty env values as unsupported and falls back to demo', async () => {
    process.env.REACT_APP_RUNTIME_MODE = '   ';
    process.env.REACT_APP_MODE = '';
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe('demo');
  });

  test.each([
    [{ runtime: 'live', app: 'demo' }, 'live'],
    [{ runtime: 'staging', app: 'demo' }, 'demo'],
    [{ runtime: '', app: 'live' }, 'live'],
    [{ runtime: undefined, app: '  LiVe ' }, 'live'],
  ])('resolves mode matrix %#', async (input, expectedMode) => {
    if (input.runtime !== undefined) process.env.REACT_APP_RUNTIME_MODE = input.runtime;
    if (input.app !== undefined) process.env.REACT_APP_MODE = input.app;
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.MODE).toBe(expectedMode);
  });

  test('resolveRuntimeMode falls back to demo when both env vars absent', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode(
      { REACT_APP_RUNTIME_MODE: '', REACT_APP_MODE: '' },
    );
    expect(mode).toBe('demo');
  });

  test('normalizeMode returns empty string for unsupported values', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.normalizeMode('staging')).toBe('');
    expect(runtimeMode.normalizeMode(null)).toBe('');
  });
});
