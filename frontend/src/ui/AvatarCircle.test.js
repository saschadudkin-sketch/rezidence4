/**
 * ui/AvatarCircle.test.js
 * Покрывает: AvatarCircle — фото, иниц. с цветом по роли, отсутствие role
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AvatarCircle } from './AvatarCircle';

describe('AvatarCircle', () => {
  test('показывает фото если avData.type === "photo" и src задан', () => {
    const avData = { type: 'photo', src: 'http://example.com/photo.jpg' };
    render(<AvatarCircle avData={avData} role="owner" name="Иван" size={40} fontSize={16} />);
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'http://example.com/photo.jpg');
  });

  test('не показывает фото если avData.src отсутствует', () => {
    const avData = { type: 'photo', src: null };
    render(<AvatarCircle avData={avData} role="owner" name="Иван" size={40} fontSize={16} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('И')).toBeInTheDocument();
  });

  test('показывает первую букву имени если нет фото', () => {
    render(<AvatarCircle role="owner" name="Алексей" size={40} fontSize={14} />);
    expect(screen.getByText('А')).toBeInTheDocument();
  });

  test('первая буква латинская тоже работает', () => {
    render(<AvatarCircle role="security" name="Guard One" size={36} fontSize={14} />);
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  test('не показывает изображение при avData.type !== "photo"', () => {
    const avData = { type: 'emoji', emoji: '😀', bg: '#ff0' };
    render(<AvatarCircle avData={avData} role="owner" name="Иван" size={40} fontSize={14} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('рендерится без avData (undefined)', () => {
    render(<AvatarCircle role="tenant" name="Светлана" size={40} fontSize={14} />);
    expect(screen.getByText('С')).toBeInTheDocument();
  });

  test('цвет фона зависит от роли — owner использует ROLE_COLOR[owner]', () => {
    const { container } = render(
      <AvatarCircle role="owner" name="Иван" size={40} fontSize={14} />
    );
    const div = container.firstChild;
    expect(div.style.background).toContain('var(--role-owner)');
  });

  test('без роли использует дефолтный цвет', () => {
    const { container } = render(
      <AvatarCircle name="Иван" size={40} fontSize={14} />
    );
    const div = container.firstChild;
    expect(div.style.background).toContain('var(--g-bg)');
  });
});
