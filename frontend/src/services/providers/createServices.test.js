import { createServices } from './createServices.js';

describe('createServices factory', () => {
  test('creates service container for demo mode', () => {
    const s = createServices('demo');

    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
    expect(typeof s.chat.sendMessage).toBe('function');
    expect(typeof s.requests.submit).toBe('function');
    expect(typeof s.requests.updateEverywhere).toBe('function');
    expect(typeof s.admin.saveUserEverywhere).toBe('function');
    expect(typeof s.liveData.startSync).toBe('function');
  });

  test('creates service container for live mode', () => {
    const s = createServices('live');
    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('falls back to demo provider for unsupported mode', () => {
    const s = createServices('staging');
    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
  });

  test('normalizes mode input (trim + lowercase)', () => {
    const s = createServices('  LIVE ');
    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('uses MODE from runtimeMode when mode argument is omitted', async () => {
    vi.resetModules();
    vi.doMock('../../config/runtimeMode.js', () => ({ MODE: 'live', LIVE_MODE: 'live', DEMO_MODE: 'demo' }));

    const { createServices: createServicesWithMockedMode } = await import('./createServices.js');
    const s = createServicesWithMockedMode();

    expect(s.mode).toBe('live');
    expect(s.provider).toBe('backend');
  });

  test('uses MODE=demo from runtimeMode when mode argument is omitted', async () => {
    vi.resetModules();
    vi.doMock('../../config/runtimeMode.js', () => ({ MODE: 'demo', LIVE_MODE: 'live', DEMO_MODE: 'demo' }));

    const { createServices: createServicesWithMockedMode } = await import('./createServices.js');
    const s = createServicesWithMockedMode();

    expect(s.mode).toBe('demo');
    expect(s.provider).toBe('demo');
  });
});
