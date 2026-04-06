import { describe, expect, test } from 'vitest';
import {
  sanitizeRequestFormFields,
  sanitizeTemplateFields,
  sanitizeUserFormFields,
  validateUserFormFields,
} from './formPolicy';

describe('formPolicy', () => {
  test('sanitizes request form fields consistently', () => {
    const out = sanitizeRequestFormFields({
      visitorName: '  Иван   Иванов ',
      visitorNames: ['  Петр  ', '   ', ' Анна '],
      visitorPhone: '8 (916) 123-45-67',
      carPlate: ' а123вс 77 ',
      comment: '  hello   world ',
    });
    expect(out).toEqual({
      visitorName: 'Иван Иванов',
      visitorNames: ['Петр', 'Анна'],
      visitorPhone: '+79161234567',
      carPlate: 'А123ВС 77',
      comment: 'hello world',
    });
  });

  test('sanitizes template and user fields + validates required name', () => {
    expect(sanitizeTemplateFields({
      name: '  Шаблон 1 ',
      visitorName: '  Имя  ',
      visitorPhone: '8 999 000 00 11',
      carPlate: ' а001аа 77 ',
      comment: '  test ',
    }).name).toBe('Шаблон 1');

    const user = sanitizeUserFormFields({
      name: '  Иван ',
      phone: '8 999 000-00-11',
      apartment: ' 12 ',
      parkingSpot: ' а001аа 77 ',
    });
    expect(user).toEqual({
      name: 'Иван',
      phone: '+79990000011',
      apartment: '12',
      parkingSpot: 'А001АА 77',
    });
    expect(validateUserFormFields({ name: '', phone: '+79990000011' })).toBe('Имя обязательно');
    expect(validateUserFormFields({ name: 'Иван', phone: '12' })).toBe('Проверьте формат номера телефона');
  });
});
