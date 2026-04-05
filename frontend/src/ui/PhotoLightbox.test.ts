/**
 * ui/PhotoLightbox.test.js
 * Покрывает: PhotoLightbox — отображение, закрытие по клику, Escape, кнопка
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhotoLightbox } from './PhotoLightbox';

describe('PhotoLightbox', () => {
  test('отображает изображение по src', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="http://example.com/img.jpg" onClose={onClose} />);
    const img = screen.getByAltText('фото');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'http://example.com/img.jpg');
  });

  test('кнопка закрытия присутствует', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    expect(screen.getByLabelText('Закрыть')).toBeInTheDocument();
  });

  test('клик по кнопке закрытия вызывает onClose', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    // Клик по кнопке всплывает на overlay, поэтому onClose вызывается дважды.
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('нажатие Escape вызывает onClose', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('нажатие другой клавиши не вызывает onClose', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('клик по overlay (backdrop) вызывает onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    // Клик по img НЕ должен закрывать
    const img = screen.getByAltText('фото');
    fireEvent.click(img);
    expect(onClose).not.toHaveBeenCalled();

    // overlay — первый div внутри portal (document.body)
    const overlay = container.querySelector('div[style*="fixed"]') ||
      document.querySelector('div[style*="position: fixed"]');
    if (overlay) {
      // Симулируем клик по overlay (target === currentTarget)
      fireEvent.click(overlay, { target: overlay });
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('снимает обработчик keydown при размонтировании', () => {
    const onClose = vi.fn();
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<PhotoLightbox src="/test.jpg" onClose={onClose} />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});
