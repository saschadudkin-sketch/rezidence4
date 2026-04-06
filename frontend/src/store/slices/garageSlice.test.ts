/**
 * garageSlice.test.js — тесты управления машинами
 */

import { garageReducer, INITIAL_GARAGE } from './garageSlice';

describe('garageReducer', () => {
  const baseState: any = { garage: { u1: [{ id: 'c1', plate: 'А123БВ77', brand: 'BMW', isMain: true, note: '' }] } };

  test('GARAGE_ADD_CAR adds to existing user', () => {
    const action: any = { type: 'GARAGE_ADD_CAR', uid: 'u1', car: { id: 'c2', plate: 'В456ГД77', brand: 'Audi', isMain: false, note: '' } };
    const result = garageReducer(baseState, action);
    expect(result.garage.u1).toHaveLength(2);
    expect(result.garage.u1[1].plate).toBe('В456ГД77');
  });

  test('GARAGE_ADD_CAR creates array for new user', () => {
    const action: any = { type: 'GARAGE_ADD_CAR', uid: 'u2', car: { id: 'c3', plate: 'Е789ЖЗ77', brand: '', isMain: true, note: '' } };
    const result = garageReducer(baseState, action);
    expect(result.garage.u2).toHaveLength(1);
  });

  test('GARAGE_UPDATE_CAR updates specific car', () => {
    const action: any = { type: 'GARAGE_UPDATE_CAR', uid: 'u1', carId: 'c1', data: { brand: 'Mercedes' } };
    const result = garageReducer(baseState, action);
    expect(result.garage.u1[0].brand).toBe('Mercedes');
    expect(result.garage.u1[0].plate).toBe('А123БВ77');
  });

  test('GARAGE_DELETE_CAR removes car', () => {
    const action: any = { type: 'GARAGE_DELETE_CAR', uid: 'u1', carId: 'c1' };
    const result = garageReducer(baseState, action);
    expect(result.garage.u1).toHaveLength(0);
  });

  test('unknown action returns state unchanged', () => {
    const result = garageReducer(baseState, { type: 'UNKNOWN' } as any);
    expect(result).toBe(baseState);
  });
});
