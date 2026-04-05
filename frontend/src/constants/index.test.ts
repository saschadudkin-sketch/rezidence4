/**
 * constants/index.test.js
 * Покрывает: ROLE_LABELS, ROLE_ICONS, ROLE_COLOR, CAT_LABEL, CAT_ICON,
 *            STS_LABEL, PASS_DURATION, CATS_WITH_CAR_PLATE, CATS_NAME_OPTIONAL и др.
 */

import {
  ROLE_LABELS, ROLE_ICONS, ROLE_COLOR,
  CAT_LABEL, CAT_ICON,
  STS_LABEL,
  PASS_DURATION, PASS_DURATION_LABEL, PASS_DURATION_ICON, PASS_DURATION_DESC,
  CATS_WITH_CAR_PLATE, CATS_NAME_OPTIONAL, CATS_WITHOUT_VISITOR,
  CATS_WITHOUT_PHONE, CATS_WITHOUT_PERMS, CATS_TECH,
  CATS_PASS_RESIDENT, CATS_PASS_CONTRACTOR,
  CONTACT_EMAIL,
} from './index';
import { APP_ICON_NAMES } from '../ui/AppIcon';

describe('ROLE_LABELS', () => {
  const roles = ['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'];

  test.each(roles)('метка для роли %s определена', (role) => {
    expect(ROLE_LABELS[role]).toBeDefined();
    expect(typeof ROLE_LABELS[role]).toBe('string');
    expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
  });

  test('owner → Собственник', () => expect(ROLE_LABELS.owner).toBe('Собственник'));
  test('admin → Администратор', () => expect(ROLE_LABELS.admin).toBe('Администратор'));
});

describe('ROLE_ICONS', () => {
  test('каждая роль имеет иконку', () => {
    ['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'].forEach(role => {
      expect(ROLE_ICONS[role]).toBeDefined();
      expect(APP_ICON_NAMES).toContain(ROLE_ICONS[role]);
    });
  });
});

describe('ROLE_COLOR', () => {
  test('каждая роль имеет CSS переменную цвета', () => {
    ['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'].forEach(role => {
      expect(ROLE_COLOR[role]).toMatch(/var\(--role-/);
    });
  });
});

describe('CAT_LABEL', () => {
  const cats = ['guest', 'courier', 'taxi', 'car', 'master', 'worker', 'team', 'delivery', 'electrician', 'plumber'];

  test.each(cats)('метка для категории %s определена', (cat) => {
    expect(CAT_LABEL[cat]).toBeDefined();
    expect(typeof CAT_LABEL[cat]).toBe('string');
  });

  test('guest → Гость', () => expect(CAT_LABEL.guest).toBe('Гость'));
  test('electrician → Электрик', () => expect(CAT_LABEL.electrician).toBe('Электрик'));
});

describe('CAT_ICON', () => {
  test('каждая категория имеет иконку', () => {
    ['guest', 'courier', 'taxi', 'car', 'master', 'worker', 'team', 'delivery', 'electrician', 'plumber'].forEach(cat => {
      expect(CAT_ICON[cat]).toBeDefined();
      expect(APP_ICON_NAMES).toContain(CAT_ICON[cat]);
    });
  });
});

describe('STS_LABEL', () => {
  const statuses = ['pending', 'approved', 'rejected', 'accepted', 'arrived', 'scheduled', 'expired', 'cancelled'];

  test.each(statuses)('метка для статуса %s определена', (status) => {
    expect(STS_LABEL[status]).toBeDefined();
    expect(typeof STS_LABEL[status]).toBe('string');
  });

  test('pending → В обработке', () => expect(STS_LABEL.pending).toBe('В обработке'));
  test('approved → Допуск открыт', () => expect(STS_LABEL.approved).toBe('Допуск открыт'));
  test('cancelled → Отменено', () => expect(STS_LABEL.cancelled).toBe('Отменено'));
});

describe('PASS_DURATION', () => {
  test('содержит once, temporary, permanent', () => {
    expect(PASS_DURATION.once).toBe('once');
    expect(PASS_DURATION.temporary).toBe('temporary');
    expect(PASS_DURATION.permanent).toBe('permanent');
  });

  test('PASS_DURATION_LABEL содержит все три типа', () => {
    expect(PASS_DURATION_LABEL.once).toBeDefined();
    expect(PASS_DURATION_LABEL.temporary).toBeDefined();
    expect(PASS_DURATION_LABEL.permanent).toBeDefined();
  });

  test('PASS_DURATION_ICON содержит иконки', () => {
    expect(PASS_DURATION_ICON.once).toBeDefined();
    expect(PASS_DURATION_ICON.temporary).toBeDefined();
    expect(PASS_DURATION_ICON.permanent).toBeDefined();
    Object.values(PASS_DURATION_ICON).forEach(iconName => {
      expect(APP_ICON_NAMES).toContain(iconName);
    });
  });

  test('PASS_DURATION_DESC содержит описания', () => {
    expect(typeof PASS_DURATION_DESC.once).toBe('string');
    expect(typeof PASS_DURATION_DESC.temporary).toBe('string');
    expect(typeof PASS_DURATION_DESC.permanent).toBe('string');
  });
});

describe('Category group arrays', () => {
  test('CATS_WITH_CAR_PLATE включает taxi и car', () => {
    expect(CATS_WITH_CAR_PLATE).toContain('taxi');
    expect(CATS_WITH_CAR_PLATE).toContain('car');
  });

  test('CATS_NAME_OPTIONAL не содержит guest (у гостя имя обязательно)', () => {
    expect(CATS_NAME_OPTIONAL).not.toContain('guest');
  });

  test('CATS_WITHOUT_VISITOR включает taxi и team', () => {
    expect(CATS_WITHOUT_VISITOR).toContain('taxi');
    expect(CATS_WITHOUT_VISITOR).toContain('team');
  });

  test('CATS_WITHOUT_PHONE включает taxi и team', () => {
    expect(CATS_WITHOUT_PHONE).toContain('taxi');
    expect(CATS_WITHOUT_PHONE).toContain('team');
  });

  test('CATS_WITHOUT_PERMS включает courier', () => {
    expect(CATS_WITHOUT_PERMS).toContain('courier');
  });

  test('CATS_TECH включает electrician и plumber', () => {
    expect(CATS_TECH).toContain('electrician');
    expect(CATS_TECH).toContain('plumber');
    expect(CATS_TECH).not.toContain('guest');
  });

  test('CATS_PASS_RESIDENT включает guest', () => {
    expect(CATS_PASS_RESIDENT).toContain('guest');
  });

  test('CATS_PASS_CONTRACTOR включает worker и team', () => {
    expect(CATS_PASS_CONTRACTOR).toContain('worker');
    expect(CATS_PASS_CONTRACTOR).toContain('team');
  });

  test('CATS_TECH и CATS_PASS_RESIDENT не пересекаются (tech ≠ pass)', () => {
    const intersection = CATS_TECH.filter(c => CATS_PASS_RESIDENT.includes(c));
    expect(intersection).toHaveLength(0);
  });
});

describe('CONTACT_EMAIL', () => {
  test('это строка с @', () => {
    expect(typeof CONTACT_EMAIL).toBe('string');
    expect(CONTACT_EMAIL).toContain('@');
  });
});
