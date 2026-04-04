/**
 * store/slices/garageSlice.ts
 * Хранилище машин квартиры.
 * Структура: { [uid]: [{ id, plate, brand, isMain, note }] }
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Car {
  id: string;
  plate: string;
  brand?: string;
  isMain?: boolean;
  note?: string;
}

export interface GarageState {
  garage: Record<string, Car[]>;
}

type GarageAction =
  | { type: 'GARAGE_ADD_CAR'; uid: string; car: Car }
  | { type: 'GARAGE_UPDATE_CAR'; uid: string; carId: string; patch?: Partial<Car>; data?: Partial<Car> }
  | { type: 'GARAGE_DELETE_CAR'; uid: string; carId: string }
  | { type: 'GARAGE_SET'; uid: string; cars: Car[] };

export const INITIAL_GARAGE: Record<string, Car[]> = {};

export function garageReducer(state: GarageState, action: GarageAction): GarageState {
  switch (action.type) {

    case 'GARAGE_ADD_CAR': {
      const cars = state.garage[action.uid] || [];
      return {
        ...state,
        garage: {
          ...state.garage,
          [action.uid]: [...cars, action.car],
        },
      };
    }

    case 'GARAGE_UPDATE_CAR': {
      const cars = state.garage[action.uid] || [];
      return {
        ...state,
        garage: {
          ...state.garage,
          [action.uid]: cars.map(c => c.id === action.carId ? { ...c, ...(action.patch || action.data || {}) } : c),
        },
      };
    }

    case 'GARAGE_DELETE_CAR': {
      const cars = state.garage[action.uid] || [];
      return {
        ...state,
        garage: {
          ...state.garage,
          [action.uid]: cars.filter(c => c.id !== action.carId),
        },
      };
    }

    case 'GARAGE_SET': {
      return {
        ...state,
        garage: { ...state.garage, [action.uid]: action.cars },
      };
    }

    default:
      return state;
  }
}
