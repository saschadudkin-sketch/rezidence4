/**
 * ui/Toggle/Toggle.test.tsx
 * Basic test for Toggle component functionality
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from './Toggle';
import { describe, expect, test, vi } from 'vitest';

describe('Toggle', () => {
  test('renders toggle in unchecked state', () => {
    const mockOnChange = vi.fn();
    render(
      <Toggle
        checked={false}
        onChange={mockOnChange}
        label="Test Feature"
        description="Test description"
      />
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    const label = screen.getByText('Test Feature');
    expect(label).toBeInTheDocument();

    const description = screen.getByText('Test description');
    expect(description).toBeInTheDocument();
  });

  test('renders toggle in checked state', () => {
    const mockOnChange = vi.fn();
    render(
      <Toggle
        checked={true}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('calls onChange when clicked', () => {
    const mockOnChange = vi.fn();
    render(
      <Toggle
        checked={false}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  test('calls onChange when space key is pressed', () => {
    const mockOnChange = vi.fn();
    render(
      <Toggle
        checked={false}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: ' ' });

    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  test('does not call onChange when disabled', () => {
    const mockOnChange = vi.fn();
    render(
      <Toggle
        checked={false}
        onChange={mockOnChange}
        disabled={true}
      />
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(mockOnChange).not.toHaveBeenCalled();
  });
});