import type { PropertyType, UnitType } from '../api/types';
export type { PropertyType } from '../api/types';

export interface PropertyLabels {
  propertyType: PropertyType;
  propertyKind: string;
  building: string;
  entrance: string;
  unit: string;
  unitLower: string;
  unitField: string;
  unitMissing: string;
  unitSelectError: string;
  noUnits: string;
  guardTitle: string;
  guardSubtitle: string;
  guardPassesTab: string;
  guardVehiclesTab: string;
  vehicleLookupTitle: string;
  vehicleLookupHint: string;
}

const LABELS: Record<PropertyType, PropertyLabels> = {
  residential_complex: {
    propertyType: 'residential_complex',
    propertyKind: 'ЖК',
    building: 'Корпус',
    entrance: 'Подъезд',
    unit: 'Квартира',
    unitLower: 'квартира',
    unitField: 'Квартира',
    unitMissing: 'Квартира не привязана — обратитесь в управляющую.',
    unitSelectError: 'Выберите квартиру',
    noUnits: 'Нет доступных квартир',
    guardTitle: 'Пост охраны',
    guardSubtitle: 'Проверка пропусков и авто',
    guardPassesTab: 'Активные пропуски',
    guardVehiclesTab: 'Авто',
    vehicleLookupTitle: 'Поиск по номеру',
    vehicleLookupHint: 'Пробелы и дефисы обрезаются, буквы приводятся к верхнему регистру',
  },
  club_house: {
    propertyType: 'club_house',
    propertyKind: 'Клубный дом',
    building: 'Корпус / секция',
    entrance: 'Вход / лобби',
    unit: 'Апартамент',
    unitLower: 'апартамент',
    unitField: 'Апартамент',
    unitMissing: 'Апартамент не привязан — обратитесь в управляющую.',
    unitSelectError: 'Выберите апартамент',
    noUnits: 'Нет доступных апартаментов',
    guardTitle: 'Пост охраны',
    guardSubtitle: 'Проверка гостей, авто и сервисных визитов',
    guardPassesTab: 'Активные пропуски',
    guardVehiclesTab: 'Авто',
    vehicleLookupTitle: 'Поиск по номеру',
    vehicleLookupHint: 'Пробелы и дефисы обрезаются, буквы приводятся к верхнему регистру',
  },
  cottage_community: {
    propertyType: 'cottage_community',
    propertyKind: 'Коттеджный посёлок',
    building: 'Сектор / улица',
    entrance: 'Контур / КПП',
    unit: 'Дом / участок',
    unitLower: 'дом / участок',
    unitField: 'Дом / участок',
    unitMissing: 'Дом или участок не привязан — обратитесь в управляющую.',
    unitSelectError: 'Выберите дом или участок',
    noUnits: 'Нет доступных домов/участков',
    guardTitle: 'Пост КПП',
    guardSubtitle: 'Vehicle-first режим: номер авто, ФИО, дом/участок, гость или подрядчик',
    guardPassesTab: 'Пропуски',
    guardVehiclesTab: 'Въезд авто',
    vehicleLookupTitle: 'Поиск авто на КПП',
    vehicleLookupHint: 'Основной сценарий КПП: номер авто проверяется до допуска на территорию',
  },
};

export function normalizePropertyType(value: unknown): PropertyType {
  return value === 'club_house' || value === 'cottage_community'
    ? value
    : 'residential_complex';
}

export function getPropertyLabels(value: unknown): PropertyLabels {
  return LABELS[normalizePropertyType(value)];
}

export function isCheckpointFirstProperty(value: unknown): boolean {
  return normalizePropertyType(value) === 'cottage_community';
}

export interface UnitLabelInput {
  unit_number?: string | null;
  unit_type?: UnitType | null;
}

export function formatUnitLabel(
  unit: UnitLabelInput,
  propertyType: unknown,
): string {
  const labels = getPropertyLabels(propertyType);
  const number = unit.unit_number?.trim();
  if (!number) return labels.unit;

  if (labels.propertyType === 'cottage_community') {
    if (unit.unit_type === 'townhouse') return `Таунхаус ${number}`;
    if (unit.unit_type === 'commercial') return `Помещение ${number}`;
    if (unit.unit_type === 'utility') return `Служебная зона ${number}`;
    return `Дом/участок ${number}`;
  }

  if (labels.propertyType === 'club_house') {
    if (unit.unit_type === 'commercial') return `Помещение ${number}`;
    return `Апартамент ${number}`;
  }

  if (unit.unit_type === 'house') return `Дом ${number}`;
  if (unit.unit_type === 'townhouse') return `Таунхаус ${number}`;
  if (unit.unit_type === 'commercial') return `Помещение ${number}`;
  if (unit.unit_type === 'utility') return `Служебная ${number}`;
  return `Квартира ${number}`;
}
