/**
 * store/slices/garageSlice.js
 * Хранилище машин квартиры.
 * Структура: { [uid]: [{ id, plate, brand, isMain, note }] }
 */

export const INITIAL_GARAGE = {};

export function garageReducer(state, action) {
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
