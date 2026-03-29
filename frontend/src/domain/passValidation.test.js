import { validatePassByRules } from './passValidation';

describe('validatePassByRules', () => {
  test('denies expired pass', () => {
    const result = validatePassByRules(
      { id: 'p1', userId: 'u1', validUntil: '2020-01-01T00:00:00.000Z' },
      { now: new Date('2021-01-01T00:00:00.000Z') },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('expired');
  });

  test('denies blacklisted pass holder by userId', () => {
    const result = validatePassByRules(
      { id: 'p2', userId: 'u2', validUntil: '2030-01-01T00:00:00.000Z' },
      { blacklist: [{ userId: 'u2' }] },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('blacklisted');
  });

  test('allows valid pass', () => {
    const result = validatePassByRules(
      { id: 'p3', userId: 'u3', validUntil: '2030-01-01T00:00:00.000Z' },
      { blacklist: [{ userId: 'u9' }] },
    );
    expect(result.status).toBe('allowed');
  });

  // FIX [BUG-2]: новые тесты — проверка blacklist по телефону и номеру авто

  test('denies by carPlate exact match', () => {
    const result = validatePassByRules(
      { id: 'p4', carPlate: 'А123БВ777', visitorPhone: null },
      { blacklist: [{ carPlate: 'А123БВ777' }] },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('blacklisted');
  });

  test('denies by carPlate ignoring spaces and case', () => {
    const result = validatePassByRules(
      { id: 'p5', carPlate: 'а 123 бв 777', visitorPhone: null },
      { blacklist: [{ carPlate: 'А123БВ777' }] },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('blacklisted');
  });

  test('denies by phone exact digits match', () => {
    const result = validatePassByRules(
      { id: 'p6', visitorPhone: '+7 916 123-45-67', carPlate: null },
      { blacklist: [{ phone: '79161234567' }] },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('blacklisted');
  });

  test('denies by phone with different formatting', () => {
    const result = validatePassByRules(
      { id: 'p7', visitorPhone: '8 (916) 123-45-67', carPlate: null },
      { blacklist: [{ phone: '+79161234567' }] },
    );
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('blacklisted');
  });

  test('allows when neither phone nor carPlate matches blacklist', () => {
    const result = validatePassByRules(
      { id: 'p8', visitorPhone: '+79001112233', carPlate: 'О999ОО99' },
      { blacklist: [{ phone: '79161234567', carPlate: 'А123БВ777' }] },
    );
    expect(result.status).toBe('allowed');
  });

  test('denies null pass', () => {
    const result = validatePassByRules(null);
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('not_found');
  });

  test('allows pass with no validUntil (permanent)', () => {
    const result = validatePassByRules(
      { id: 'p9', userId: 'u9', validUntil: null },
      { blacklist: [] },
    );
    expect(result.status).toBe('allowed');
  });
});

