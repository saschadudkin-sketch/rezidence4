import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import PageActionBar from './PageActionBar';

describe('PageActionBar', () => {
  test('closes overflow menu after outside click', () => {
    render(
      <PageActionBar
        primaryLabel="Создать"
        onPrimary={vi.fn()}
        secondary={[{ label: 'Открыть шаблоны', onClick: vi.fn() }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ещё/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('closes overflow menu before primary action', () => {
    const onPrimary = vi.fn();

    render(
      <PageActionBar
        primaryLabel="Создать"
        onPrimary={onPrimary}
        secondary={[{ label: 'Открыть шаблоны', onClick: vi.fn() }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ещё/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
