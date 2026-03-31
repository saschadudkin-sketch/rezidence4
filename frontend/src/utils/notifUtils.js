import { getSwReg } from './swUtils.js';

/** Запрашивает разрешение на push-уведомления */
export const requestNotifPerm = () => {
  if ('Notification' in window && Notification.permission === 'default')
    Notification.requestPermission();
};

/** Показывает системное уведомление (через SW или напрямую) */
export const sendNotif = (title, body, tag) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const swReg = getSwReg();
    if (swReg) {
      swReg.showNotification(title, {
        body,
        tag:      tag || 'default',
        renotify: true,
        icon:     '/logo192.png',
        badge:    '/logo192.png',
        vibrate:  [200, 100, 200],
      });
    } else {
      new Notification(title, { body, icon: '/logo192.png' });
    }
  } catch (e) { /* silent */ }
};

// FIX [PERF/RESOURCE]: один AudioContext на модуль — не создаём новый при каждом сигнале.
// Браузеры ограничивают количество одновременных AudioContext (~6 штук).
let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx && _audioCtx.state !== 'closed') return _audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  _audioCtx = new Ctor();
  return _audioCtx;
}

/** Воспроизводит звуковой сигнал типа «pass» или «tech» */
export const playAlert = (type) => {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    // Возобновляем контекст если он был приостановлен браузером
    if (ctx.state === 'suspended') ctx.resume();
    const notes = type === 'pass'
      ? [[880, 0, .12], [1046, 0.13, .12], [1318, 0.26, .18]]
      : [[660, 0, .1],  [660, .12, .1],    [880,  .25, .15]];
    notes.forEach(([freq, delay, dur]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0, ctx.currentTime + delay);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + dur + 0.05);
    });
    // Не закрываем ctx — переиспользуем в следующем вызове
  } catch (e) { /* silent */ }
};
