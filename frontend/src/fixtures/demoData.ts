/**
 * src/fixtures/demoData.js
 * Демо-данные только для demo-режима. НЕ импортируется в production-сборке.
 * Подгружается в createServices.js при isDemoMode().
 */

// FIX [DATA]: DEMO_REQUESTS как фабрика — даты вычисляются при вызове, не при импорте.
// Это гарантирует корректные относительные метки («1 час назад») при каждом новом сеансе.
export function makeDemoRequests() {
  return [
  { id: 'r1', type: 'pass',  category: 'guest',       createdByUid: 'u1', createdByRole: 'owner',      createdByName: 'Михаил Волков', createdByApt: '12', visitorName: 'Дмитрий Орлов',   visitorPhone: '+7 916 777-88-99', comment: 'Гость на обед около 14:00',       photo: null, priority: 'normal', passDuration: 'once',      validUntil: null, status: 'approved', createdAt: new Date(Date.now() - 3_600_000),  arrivedAt: null, photos: [] },
  { id: 'r2', type: 'pass',  category: 'courier',     createdByUid: 'u2', createdByRole: 'tenant',     createdByName: 'Анна Соколова', createdByApt: '34', visitorName: 'СДЭК',             visitorPhone: null,               comment: '',                                photo: null, priority: 'normal', passDuration: 'once',      validUntil: null, status: 'approved', createdAt: new Date(Date.now() - 7_200_000),  arrivedAt: null, photos: [] },
  { id: 'r3', type: 'tech',  category: 'electrician', createdByUid: 'u1', createdByRole: 'owner',      createdByName: 'Михаил Волков', createdByApt: '12', visitorName: null,               visitorPhone: null,               comment: 'Не работает розетка в гостиной',  photo: null, priority: 'normal', passDuration: null,        validUntil: null, status: 'pending',  createdAt: new Date(Date.now() - 1_800_000),  arrivedAt: null, photos: [] },
  { id: 'r4', type: 'pass',  category: 'taxi',        createdByUid: 'u2', createdByRole: 'tenant',     createdByName: 'Анна Соколова', createdByApt: '34', visitorName: 'Яндекс.Такси',    visitorPhone: null,               comment: '',                                photo: null, priority: 'normal', passDuration: 'once',      validUntil: null, status: 'rejected', createdAt: new Date(Date.now() - 86_400_000), arrivedAt: null, photos: [] },
  { id: 'r5', type: 'pass',  category: 'worker',      createdByUid: 'u3', createdByRole: 'contractor', createdByName: 'Строй Групп',   createdByApt: '—',  visitorName: 'Бригада (3 чел.)', visitorPhone: '+7 903 111-22-33', comment: 'Работы в апартаментах 45',        photo: null, priority: 'normal', passDuration: 'temporary', validUntil: new Date(Date.now() + 7 * 86_400_000), status: 'pending',  createdAt: new Date(Date.now() - 900_000),    arrivedAt: null, photos: [] },
  { id: 'r6', type: 'tech',  category: 'plumber',     createdByUid: 'u2', createdByRole: 'tenant',     createdByName: 'Анна Соколова', createdByApt: '34', visitorName: null,               visitorPhone: null,               comment: 'Течёт кран на кухне',             photo: null, priority: 'normal', passDuration: null,        validUntil: null, status: 'accepted', createdAt: new Date(Date.now() - 43_200_000), arrivedAt: null, photos: [] },
  ];
}
export const DEMO_REQUESTS = makeDemoRequests();
