describe('createServices factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('creates service container for demo mode when demo sandbox is enabled', async () => {
    vi.doMock('../../config/runtimeMode', () => ({
      MODE: 'demo',
      LIVE_MODE: 'live',
      DEMO_MODE: 'demo',
      DEMO_ENABLED: true,
      normalizeMode: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    }));

    const { createServices } = await import('./createServices');
    const s = createServices('demo');

    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
    expect(typeof s.chat.sendMessage).toBe('function');
    expect(typeof s.requests.submit).toBe('function');
    expect(typeof s.requests.updateEverywhere).toBe('function');
    expect(typeof s.admin.saveUserEverywhere).toBe('function');
    expect(typeof s.liveData.startSync).toBe('function');
  });

  test('creates service container for live mode', async () => {
    const { createServices } = await import('./createServices');
    const s = createServices('live');
    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('falls back to demo provider for unsupported mode when demo sandbox is enabled', async () => {
    vi.doMock('../../config/runtimeMode', () => ({
      MODE: 'demo',
      LIVE_MODE: 'live',
      DEMO_MODE: 'demo',
      DEMO_ENABLED: true,
      normalizeMode: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    }));

    const { createServices } = await import('./createServices');
    const s = createServices('staging');
    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
  });

  test('normalizes mode input (trim + lowercase)', async () => {
    const { createServices } = await import('./createServices');
    const s = createServices('  LIVE ');
    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('uses MODE from runtimeMode when mode argument is omitted', async () => {
    vi.doMock('../../config/runtimeMode', () => ({
      MODE: 'live',
      LIVE_MODE: 'live',
      DEMO_MODE: 'demo',
      DEMO_ENABLED: false,
      normalizeMode: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    }));

    const { createServices } = await import('./createServices');
    const s = createServices();

    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('uses MODE=demo from runtimeMode when mode argument is omitted', async () => {
    vi.doMock('../../config/runtimeMode', () => ({
      MODE: 'demo',
      LIVE_MODE: 'live',
      DEMO_MODE: 'demo',
      DEMO_ENABLED: true,
      normalizeMode: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    }));

    const { createServices } = await import('./createServices');
    const s = createServices();

    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
  });

  test('forces live provider when demo mode is disabled in runtime config', async () => {
    vi.doMock('../../config/runtimeMode', () => ({
      MODE: 'live',
      LIVE_MODE: 'live',
      DEMO_MODE: 'demo',
      DEMO_ENABLED: false,
      normalizeMode: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    }));

    const { createServices } = await import('./createServices');
    const s = createServices('demo');

    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });
});
