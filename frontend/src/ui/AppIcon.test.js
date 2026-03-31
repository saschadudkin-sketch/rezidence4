import { render } from '@testing-library/react';
import { AppIcon, APP_ICON_NAMES, __resetAppIconWarningsForTests } from './AppIcon';

describe('AppIcon', () => {
  let warnSpy;
  beforeEach(() => {
    __resetAppIconWarningsForTests();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('рендерит svg с ожидаемыми атрибутами', () => {
    const { container } = render(<AppIcon name="shield" size={20} className="custom-ico" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg).toHaveClass('app-icon');
    expect(svg).toHaveClass('custom-ico');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  test('для неизвестного имени использует fallback и не падает', () => {
    const { container } = render(<AppIcon name="unknown-icon-name" />);
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('d')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('для одного неизвестного имени предупреждение выводится только один раз', () => {
    render(<AppIcon name="same-unknown-icon" />);
    render(<AppIcon name="same-unknown-icon" />);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('после сброса тестового кеша предупреждение может появиться снова', () => {
    render(<AppIcon name="resettable-unknown-icon" />);
    __resetAppIconWarningsForTests();
    render(<AppIcon name="resettable-unknown-icon" />);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('без имени и с пустым именем работает без предупреждений', () => {
    render(<AppIcon />);
    render(<AppIcon name="" />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('после переполнения кеша предупреждений старые имена снова предупреждаются', () => {
    for (let i = 0; i <= 200; i += 1) {
      render(<AppIcon name={`overflow-unknown-${i}`} />);
    }
    render(<AppIcon name="overflow-unknown-0" />);
    expect(warnSpy).toHaveBeenCalledTimes(202);
  });
});

describe('APP_ICON_NAMES', () => {
  test('экспортирует известные имена иконок и список заморожен', () => {
    expect(APP_ICON_NAMES).toContain('list');
    expect(APP_ICON_NAMES).toContain('ticket');
    expect(APP_ICON_NAMES).toContain('users');
    expect(Object.isFrozen(APP_ICON_NAMES)).toBe(true);
  });

  test('каждое имя из реестра успешно рендерится', () => {
    APP_ICON_NAMES.forEach((iconName) => {
      const { container, unmount } = render(<AppIcon name={iconName} />);
      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path.getAttribute('d')).toBeTruthy();
      unmount();
    });
  });
});
