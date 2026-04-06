import { render, screen, fireEvent } from '@testing-library/react';
import { useModalAccessibility } from './useModalAccessibility';

function ModalHarness({ onClose }: { onClose: () => void }) {
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  return (
    <div data-testid="overlay" {...overlayProps}>
      <div ref={dialogRef} role="dialog" tabIndex={-1}>
        <button>first</button>
        <button>last</button>
      </div>
    </div>
  );
}

describe('useModalAccessibility interaction contract', () => {
  test('Escape closes dialog', () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('overlay click closes dialog', () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    fireEvent.click(screen.getByTestId('overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
