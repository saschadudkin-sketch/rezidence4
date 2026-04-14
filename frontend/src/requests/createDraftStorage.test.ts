import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearCreateDraft, getCreateDraftKey, loadCreateDraft, saveCreateDraft } from './createDraftStorage';

describe('createDraftStorage', () => {
  const key = getCreateDraftKey('u1', 'owner', 'pass');

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test('saves and loads a draft snapshot', () => {
    saveCreateDraft(key, {
      cat: 'guest',
      vName: 'Иван',
      vNames: ['Иван'],
      vPhone: '+79001234567',
      carPlate: '',
      apartment: '12',
      comment: 'Комментарий',
      validUntil: '',
      showSchedule: false,
      scheduledFor: '',
      residentStep: 1,
      showAdvanced: false,
    });

    expect(loadCreateDraft(key)).toMatchObject({
      cat: 'guest',
      vName: 'Иван',
      apartment: '12',
      residentStep: 1,
    });
    expect(window.sessionStorage.getItem(key)).toContain('"cat":"guest"');
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  test('expires stale drafts automatically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T10:00:00Z'));

    saveCreateDraft(key, {
      cat: 'guest',
      vName: '',
      vNames: [],
      vPhone: '',
      carPlate: '',
      apartment: '',
      comment: '',
      validUntil: '',
      showSchedule: false,
      scheduledFor: '',
    });

    vi.setSystemTime(new Date('2026-04-14T10:00:01Z'));
    expect(loadCreateDraft(key)).toBeNull();
  });

  test('clears saved draft explicitly', () => {
    saveCreateDraft(key, {
      cat: 'guest',
      vName: '',
      vNames: [],
      vPhone: '',
      carPlate: '',
      apartment: '',
      comment: '',
      validUntil: '',
      showSchedule: false,
      scheduledFor: '',
    });

    clearCreateDraft(key);
    expect(loadCreateDraft(key)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  test('migrates legacy draft from localStorage into sessionStorage on load', () => {
    window.localStorage.setItem(key, JSON.stringify({
      cat: 'guest',
      vName: 'Legacy',
      vNames: ['Legacy'],
      vPhone: '',
      carPlate: '',
      apartment: '7',
      comment: '',
      validUntil: '',
      showSchedule: false,
      scheduledFor: '',
      updatedAt: Date.now(),
    }));

    expect(loadCreateDraft(key)).toMatchObject({ vName: 'Legacy', apartment: '7' });
    expect(window.sessionStorage.getItem(key)).toContain('"vName":"Legacy"');
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
