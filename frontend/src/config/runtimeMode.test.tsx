describe('runtimeMode', () => {
  const loadRuntimeMode = async () => import('./runtimeMode');

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  test('defaults to demo in dev when no env override is provided', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({ PROD: false, VITE_RUNTIME_MODE: '', VITE_MODE: '' });
    expect(mode).toBe('demo');
  });

  test('defaults to live in production when demo is not explicitly enabled', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({ PROD: true, VITE_RUNTIME_MODE: '', VITE_MODE: '' });
    expect(mode).toBe('live');
  });

  test('uses VITE_RUNTIME_MODE when provided', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({ PROD: true, VITE_RUNTIME_MODE: 'live', VITE_MODE: 'demo' });
    expect(mode).toBe('live');
  });

  test('falls back to VITE_MODE when VITE_RUNTIME_MODE is absent', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({ PROD: true, VITE_MODE: 'live' });
    expect(mode).toBe('live');
  });

  test('VITE_RUNTIME_MODE has priority over VITE_MODE', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_RUNTIME_MODE: 'demo',
      VITE_MODE: 'live',
      VITE_ENABLE_DEMO: 'true',
    });
    expect(mode).toBe('demo');
  });

  test('forces live when demo mode is requested without demo flag in production', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_RUNTIME_MODE: 'demo',
      VITE_ENABLE_DEMO: 'false',
    });
    expect(mode).toBe('live');
  });

  test('allows demo in production only when internal demo flag is enabled', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_RUNTIME_MODE: 'demo',
      VITE_ENABLE_DEMO: 'true',
    });
    expect(mode).toBe('demo');
  });

  test('falls back to VITE_MODE when VITE_RUNTIME_MODE is invalid', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_RUNTIME_MODE: 'staging',
      VITE_MODE: 'live',
    });
    expect(mode).toBe('live');
  });

  test('normalizes env values (trim + lowercase)', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_RUNTIME_MODE: '  LIVE  ',
    });
    expect(mode).toBe('live');
  });

  test('normalizes VITE_MODE when runtime mode is absent', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: true,
      VITE_MODE: '  DeMo ',
      VITE_ENABLE_DEMO: 'true',
    });
    expect(mode).toBe('demo');
  });

  test('ignores unsupported mode values', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: false,
      VITE_RUNTIME_MODE: 'staging',
    });
    expect(mode).toBe('demo');
  });

  test('treats empty env values as unsupported and falls back to env-aware default', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: false,
      VITE_RUNTIME_MODE: '   ',
      VITE_MODE: '',
    });
    expect(mode).toBe('demo');
  });

  test.each([
    [{ PROD: true, runtime: 'live', app: 'demo', demoFlag: 'true' }, 'live'],
    [{ PROD: true, runtime: 'staging', app: 'demo', demoFlag: 'true' }, 'demo'],
    [{ PROD: true, runtime: '', app: 'live' }, 'live'],
    [{ PROD: true, runtime: undefined, app: '  LiVe ' }, 'live'],
  ])('resolves mode matrix %#', async (input, expectedMode) => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode({
      PROD: input.PROD,
      VITE_RUNTIME_MODE: input.runtime,
      VITE_MODE: input.app,
      VITE_ENABLE_DEMO: input.demoFlag,
    });
    expect(mode).toBe(expectedMode);
  });

  test('resolveRuntimeMode falls back to demo in dev when both env vars absent', async () => {
    const runtimeMode = await loadRuntimeMode();
    const mode = runtimeMode.resolveRuntimeMode(
      { PROD: false, VITE_RUNTIME_MODE: '', VITE_MODE: '' },
    );
    expect(mode).toBe('demo');
  });

  test('isDemoEnabled defaults to false in production and true in dev', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.isDemoEnabled({ PROD: true })).toBe(false);
    expect(runtimeMode.isDemoEnabled({ PROD: false })).toBe(true);
  });

  test('isDemoEnabled respects explicit boolean env flag', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.isDemoEnabled({ PROD: true, VITE_ENABLE_DEMO: 'true' })).toBe(true);
    expect(runtimeMode.isDemoEnabled({ PROD: false, VITE_ENABLE_DEMO: '0' })).toBe(false);
  });

  test('normalizeMode returns empty string for unsupported values', async () => {
    const runtimeMode = await loadRuntimeMode();
    expect(runtimeMode.normalizeMode('staging')).toBe('');
    expect(runtimeMode.normalizeMode(null)).toBe('');
  });
});
