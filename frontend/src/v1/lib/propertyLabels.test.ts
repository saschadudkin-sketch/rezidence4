import { describe, expect, test } from 'vitest';
import {
  formatUnitLabel,
  getPropertyLabels,
  isCheckpointFirstProperty,
  normalizePropertyType,
} from './propertyLabels';

describe('propertyLabels', () => {
  test('defaults unknown property type to residential complex labels', () => {
    expect(normalizePropertyType(undefined)).toBe('residential_complex');
    expect(getPropertyLabels('unknown').unitField).toBe('Квартира');
    expect(isCheckpointFirstProperty('unknown')).toBe(false);
  });

  test('uses cottage-community labels for homes, plots, and checkpoint mode', () => {
    const labels = getPropertyLabels('cottage_community');

    expect(labels.unitField).toBe('Дом / участок');
    expect(labels.guardTitle).toBe('Пост КПП');
    expect(labels.guardVehiclesTab).toBe('Въезд авто');
    expect(isCheckpointFirstProperty('cottage_community')).toBe(true);
    expect(formatUnitLabel({ unit_number: '14', unit_type: 'house' }, 'cottage_community'))
      .toBe('Дом/участок 14');
  });

  test('keeps apartment labels for residential complexes', () => {
    expect(formatUnitLabel({ unit_number: '42', unit_type: 'apartment' }, 'residential_complex'))
      .toBe('Квартира 42');
  });
});
