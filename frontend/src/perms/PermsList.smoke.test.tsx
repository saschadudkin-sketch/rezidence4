import React from 'react';
import { render, screen } from '@testing-library/react';
import { PermsList, MyTemplates } from './PermsList';

vi.mock('../utils', () => ({ genId: () => 'gen-id' }));

describe('PermsList', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<PermsList user={user} />)).not.toThrow();
  });

  test('показывает кнопку добавления гостя', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<PermsList user={user} />);
    expect(screen.getAllByText(/добавить/i).length).toBeGreaterThan(0);
  });
});

describe('MyTemplates', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<MyTemplates user={user} onUse={vi.fn()} />)).not.toThrow();
  });
});
