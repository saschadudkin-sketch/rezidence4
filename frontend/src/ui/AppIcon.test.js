import { render } from '@testing-library/react';
import { AppIcon, APP_ICON_NAMES } from './AppIcon';

describe('AppIcon', () => {
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
  });
});

describe('APP_ICON_NAMES', () => {
  test('экспортирует известные имена иконок и список заморожен', () => {
    expect(APP_ICON_NAMES).toContain('list');
    expect(APP_ICON_NAMES).toContain('ticket');
    expect(APP_ICON_NAMES).toContain('users');
    expect(Object.isFrozen(APP_ICON_NAMES)).toBe(true);
  });
});
