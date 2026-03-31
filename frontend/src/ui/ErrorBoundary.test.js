/**
 * ui/ErrorBoundary.test.js
 * Покрывает: ErrorBoundary — перехват ошибок, fallback, сброс
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Подавляем console.error от React для ожидаемых ошибок в тестах
const suppressErrors = () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return spy;
};

// Компонент который бросает ошибку
function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error('Тестовая ошибка');
  return <div>Всё хорошо</div>;
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  test('рендерит children если ошибки нет', () => {
    render(
      <ErrorBoundary name="Тест">
        <div>Контент</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Контент')).toBeInTheDocument();
  });

  test('перехватывает ошибку и показывает fallback UI', () => {
    suppressErrors();
    render(
      <ErrorBoundary name="Чат">
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Чат не смог загрузиться/)).toBeInTheDocument();
  });

  test('показывает сообщение об ошибке', () => {
    suppressErrors();
    render(
      <ErrorBoundary name="Компонент">
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Тестовая ошибка')).toBeInTheDocument();
  });

  test('кнопка "Попробовать снова" присутствует при ошибке', () => {
    suppressErrors();
    render(
      <ErrorBoundary name="Тест">
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Попробовать снова')).toBeInTheDocument();
  });

  test('кнопка сброса возвращает к нормальному рендеру', () => {
    suppressErrors();
    const { rerender } = render(
      <ErrorBoundary name="Тест">
        <Bomb shouldThrow />
      </ErrorBoundary>
    );

    // Меняем пропсы ДО сброса, чтобы после reset boundary смонтировал уже "здорового" ребёнка.
    rerender(
      <ErrorBoundary name="Тест">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Попробовать снова'));

    expect(screen.getByText('Всё хорошо')).toBeInTheDocument();
  });

  test('кастомный fallback отображается вместо дефолтного', () => {
    suppressErrors();
    render(
      <ErrorBoundary name="Тест" fallback={<div>Кастомная ошибка</div>}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Кастомная ошибка')).toBeInTheDocument();
    expect(screen.queryByText('Попробовать снова')).not.toBeInTheDocument();
  });

  test('name без явного prop = "Компонент" в заголовке ошибки', () => {
    suppressErrors();
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Компонент не смог загрузиться/)).toBeInTheDocument();
  });

  test('иконка ошибки отображается при ошибке', () => {
    suppressErrors();
    const { container } = render(
      <ErrorBoundary name="Тест">
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(container.querySelector('.app-icon')).toBeInTheDocument();
  });
});
