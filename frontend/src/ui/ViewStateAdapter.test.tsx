import { render, screen } from '@testing-library/react';
import ViewStateAdapter from './ViewStateAdapter';

describe('ViewStateAdapter contract', () => {
  test.each([
    ['requests', 'loading', /загрузка заявок/i],
    ['history', 'empty', /нет завершённых заявок/i],
    ['security_passes', 'error', /не удалось загрузить пропуска/i],
  ] as const)('renders consistent copy for %s/%s', (entity, state, expectedTitle) => {
    render(
      <ViewStateAdapter
        entity={entity}
        state={state}
        actionLabel="Повторить"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText(expectedTitle)).toBeInTheDocument();
  });

  test('uses explicit override title/subtitle for UX harmonization', () => {
    render(
      <ViewStateAdapter
        entity="requests"
        state="error"
        title="Кастомный заголовок"
        subtitle="Кастомный подзаголовок"
        actionLabel="Обновить"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('Кастомный заголовок')).toBeInTheDocument();
    expect(screen.getByText('Кастомный подзаголовок')).toBeInTheDocument();
  });
});
