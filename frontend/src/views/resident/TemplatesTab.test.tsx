import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import TemplatesTab from './TemplatesTab';

vi.mock('../../perms/PermsList', () => ({
  MyTemplates: (props) => {
    return (
      <button
        type="button"
        onClick={() => props.onUse({
          type: 'pass',
          category: 'guest',
          visitorName: 'Дмитрий Орлов',
          visitorPhone: '+7 916 777-88-99',
          carPlate: '',
          comment: 'Позвонить у КПП',
        })}
      >
        Использовать шаблон
      </button>
    );
  },
}));

describe('TemplatesTab', () => {
  test('opens resident pass templates on the visitor-details step', () => {
    const setModal = vi.fn();

    render(<TemplatesTab user={{ uid: 'u1', role: 'owner', name: 'Михаил Волков' }} setModal={setModal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Использовать шаблон' }));

    expect(setModal).toHaveBeenCalledWith({
      type: 'pass',
      cat: 'guest',
      data: {
        visitorName: 'Дмитрий Орлов',
        visitorPhone: '+7 916 777-88-99',
        carPlate: '',
        comment: 'Позвонить у КПП',
      },
      initialStep: 1,
    });
  });
});
