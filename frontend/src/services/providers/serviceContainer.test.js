import { services } from './serviceContainer';

describe('serviceContainer smoke', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./createServices.js');
    vi.doUnmock('../../config/runtimeMode.js');
  });

  test('exports wired services object with expected surface', () => {
    expect(['demo', 'live']).toContain(services.mode);

    expect(typeof services.chat.sendMessage).toBe('function');

    expect(typeof services.requests.resolvePhotos).toBe('function');
    expect(typeof services.requests.submit).toBe('function');
    expect(typeof services.requests.updateEverywhere).toBe('function');
    expect(typeof services.requests.deleteEverywhere).toBe('function');

    expect(typeof services.admin.savePermsEverywhere).toBe('function');
    expect(typeof services.admin.saveUserEverywhere).toBe('function');
    expect(typeof services.admin.removeUserEverywhere).toBe('function');

    expect(typeof services.liveData.startSync).toBe('function');
  });

  test('builds services via createServices on module init', async () => {
    const fakeServices = {
      mode: 'live',
      provider: 'backend',
      chat: { sendMessage: vi.fn() },
      requests: { resolvePhotos: vi.fn(), submit: vi.fn(), updateEverywhere: vi.fn(), deleteEverywhere: vi.fn() },
      admin: { savePermsEverywhere: vi.fn(), saveUserEverywhere: vi.fn(), removeUserEverywhere: vi.fn() },
      liveData: { startSync: vi.fn() },
    };
    const createServices = vi.fn(() => fakeServices);

    vi.doMock('./createServices.js', () => ({ createServices }));
    const { services: mockedServices } = await import('./serviceContainer.js');

    expect(createServices).toHaveBeenCalledTimes(1);
    expect(mockedServices).toBe(fakeServices);
  });

  test('keeps singleton export across repeated imports', async () => {
    const fakeServices = { mode: 'demo', provider: 'demo' };
    const createServices = vi.fn(() => fakeServices);

    vi.doMock('./createServices.js', () => ({ createServices }));
    const firstImport = await import('./serviceContainer.js');
    const secondImport = await import('./serviceContainer.js');

    expect(createServices).toHaveBeenCalledTimes(1);
    expect(firstImport.services).toBe(secondImport.services);
  });

  test('resolves default mode through runtimeMode -> createServices integration', async () => {
    vi.doUnmock('./createServices.js');
    vi.doMock('../../config/runtimeMode.js', () => ({ MODE: 'live', LIVE_MODE: 'live', DEMO_MODE: 'demo' }));

    const { services: liveServices } = await import('./serviceContainer.js');

    expect(liveServices.mode).toBe('live');
    expect(liveServices.provider).toBe('backend');
  });

  test('resolves demo mode through runtimeMode -> createServices integration', async () => {
    vi.doUnmock('./createServices.js');
    vi.doMock('../../config/runtimeMode.js', () => ({ MODE: 'demo', LIVE_MODE: 'live', DEMO_MODE: 'demo' }));

    const { services: demoServices } = await import('./serviceContainer.js');

    expect(demoServices.mode).toBe('demo');
    expect(demoServices.provider).toBe('demo');
  });
});
