/**
 * utils/swUtils.test.js
 * Покрывает: getSwReg, registerSW
 */

// Перезагружаем модуль в каждом тесте чтобы сбросить _swReg
beforeEach(() => jest.resetModules());

describe('getSwReg', () => {
  it('возвращает null до регистрации SW', async () => {
    const { getSwReg } = await import('./swUtils');
    expect(getSwReg()).toBeNull();
  });
});

describe('registerSW', () => {
  it('не падает если serviceWorker отсутствует в navigator', async () => {
    // В JSDOM окружении navigator.serviceWorker может быть не определён
    const orig = navigator.serviceWorker;
    delete navigator.serviceWorker;
    const { registerSW } = await import('./swUtils');
    expect(() => registerSW()).not.toThrow();
    if (orig) Object.defineProperty(navigator, 'serviceWorker', { value: orig, configurable: true });
  });

  it('вызывает navigator.serviceWorker.register если SW доступен', async () => {
    const mockReg = {};
    const mockRegister = jest.fn().mockResolvedValue(mockReg);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: mockRegister },
      configurable: true,
    });

    const { registerSW, getSwReg } = await import('./swUtils');
    registerSW();

    // Ждём resolve промиса
    await new Promise(r => setTimeout(r, 0));

    expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('после успешной регистрации getSwReg возвращает объект', async () => {
    const mockReg = { active: true };
    const mockRegister = jest.fn().mockResolvedValue(mockReg);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: mockRegister },
      configurable: true,
    });

    const { registerSW, getSwReg } = await import('./swUtils');
    registerSW();
    await new Promise(r => setTimeout(r, 0));

    expect(getSwReg()).toBe(mockReg);
  });

  it('не бросает при ошибке регистрации (catch silent)', async () => {
    const mockRegister = jest.fn().mockRejectedValue(new Error('SW error'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: mockRegister },
      configurable: true,
    });

    const { registerSW } = await import('./swUtils');
    registerSW();
    await new Promise(r => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledWith('[SW] registration failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
