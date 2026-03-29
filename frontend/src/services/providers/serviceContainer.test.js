import { services } from './serviceContainer';

describe('serviceContainer smoke', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('./createServices');
    jest.dontMock('../../config/runtimeMode');
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

  test('builds services via createServices on module init', () => {
    const fakeServices = {
      mode: 'live',
      provider: 'backend',
      chat: { sendMessage: jest.fn() },
      requests: { resolvePhotos: jest.fn(), submit: jest.fn(), updateEverywhere: jest.fn(), deleteEverywhere: jest.fn() },
      admin: { savePermsEverywhere: jest.fn(), saveUserEverywhere: jest.fn(), removeUserEverywhere: jest.fn() },
      liveData: { startSync: jest.fn() },
    };
    const createServices = jest.fn(() => fakeServices);

    jest.doMock('./createServices', () => ({ createServices }));
    const { services: mockedServices } = require('./serviceContainer');

    expect(createServices).toHaveBeenCalledTimes(1);
    expect(mockedServices).toBe(fakeServices);
  });

  test('keeps singleton export across repeated imports', () => {
    const fakeServices = { mode: 'demo', provider: 'demo' };
    const createServices = jest.fn(() => fakeServices);

    jest.doMock('./createServices', () => ({ createServices }));
    const firstImport = require('./serviceContainer');
    const secondImport = require('./serviceContainer');

    expect(createServices).toHaveBeenCalledTimes(1);
    expect(firstImport.services).toBe(secondImport.services);
  });

  test('resolves default mode through runtimeMode -> createServices integration', () => {
    jest.dontMock('./createServices');
    jest.doMock('../../config/runtimeMode', () => ({ MODE: 'live' }));

    const { services: liveServices } = require('./serviceContainer');

    expect(liveServices.mode).toBe('live');
    expect(liveServices.provider).toBe('backend');
  });

  test('resolves demo mode through runtimeMode -> createServices integration', () => {
    jest.dontMock('./createServices');
    jest.doMock('../../config/runtimeMode', () => ({ MODE: 'demo' }));

    const { services: demoServices } = require('./serviceContainer');

    expect(demoServices.mode).toBe('demo');
    expect(demoServices.provider).toBe('demo');
  });
});
