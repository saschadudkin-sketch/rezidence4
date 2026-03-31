/**
 * ui/scrollLock.test.js
 * Покрывает: lockScroll, unlockScroll — счётчик вложенности
 */

// Перезагружаем модуль перед каждым тестом чтобы сбросить lockCount до 0
beforeEach(() => {
  vi.resetModules();
  document.body.style.overflow = ''; // чистим DOM
});

async function getModule() {
  const mod = await import('./scrollLock');
  return mod;
}

describe('lockScroll / unlockScroll', () => {
  test('lockScroll устанавливает overflow: hidden', async () => {
    const { lockScroll } = await getModule();
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('unlockScroll снимает overflow после одного lock', async () => {
    const { lockScroll, unlockScroll } = await getModule();
    lockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  test('вложенные lock: overflow остаётся hidden пока не все unlock', async () => {
    const { lockScroll, unlockScroll } = await getModule();
    lockScroll(); // count = 1
    lockScroll(); // count = 2
    unlockScroll(); // count = 1 — hidden остаётся
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll(); // count = 0 — снимается
    expect(document.body.style.overflow).toBe('');
  });

  test('тройная вложенность', async () => {
    const { lockScroll, unlockScroll } = await getModule();
    lockScroll();
    lockScroll();
    lockScroll();
    unlockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  test('unlockScroll без предварительного lock не уходит в отрицательные значения', async () => {
    const { unlockScroll } = await getModule();
    expect(() => unlockScroll()).not.toThrow();
    // overflow уже был пустым — остаётся пустым
    expect(document.body.style.overflow).toBe('');
  });

  test('повторный unlock после нуля не меняет overflow', async () => {
    const { lockScroll, unlockScroll } = await getModule();
    lockScroll();
    unlockScroll();
    unlockScroll(); // лишний unlock
    expect(document.body.style.overflow).toBe('');
  });

  test('overflow: hidden устанавливается только при первом lock', async () => {
    const { lockScroll } = await getModule();
    // Следим за присваиванием
    const setSpy = vi.fn();
    Object.defineProperty(document.body.style, 'overflow', {
      get: () => '',
      set: setSpy,
      configurable: true,
    });

    lockScroll(); // count 0→1: должен установить hidden
    lockScroll(); // count 1→2: НЕ должен устанавливать снова

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith('hidden');
  });
});
