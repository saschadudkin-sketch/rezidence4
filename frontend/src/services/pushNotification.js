/**
 * pushNotification.js — Push-уведомления жильцам
 *
 * Архитектура:
 * 1. Каждый жилец при входе подписывается на push (в production через FCM / другой провайдер)
 * 2. При входе гостя охрана вызывает pushNotifyResident(req)
 * 3. В demo-режиме — локальный showNotification через SW (работает без сервера)
 * 4. В live-режиме — отправка через push сервер (настраивается отдельно)
 */

import { sendNotif } from '../utils.js';
import { CAT_LABEL } from '../constants';

/** Возвращает читаемое имя гостя */
function getGuestLabel(req) {
  if (req.visitorName) return req.visitorName;
  return CAT_LABEL[req.category] || 'Гость';
}

/**
 * Отправляет push-уведомление жильцу что его гость вошёл.
 * В demo-режиме — через локальный Service Worker (работает на этом устройстве).
 * В live-режиме — через FCM (требует серверный Cloud Function).
 *
 * @param {object} req — заявка с полями createdByApt, visitorName, category
 */
export function pushNotifyResident(req) {
  const guestLabel = getGuestLabel(req);
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const aptStr = req.createdByApt && req.createdByApt !== '—' ? ', апарт. ' + req.createdByApt : '';

  const title = '🚪 Ваш гость вошёл';
  const body  = guestLabel + aptStr + ' — вход в ' + time;
  const tag   = 'guest-arrived-' + req.id;

  // ── Demo: показываем уведомление прямо на этом устройстве (охраны) ──────────
  // В реальном приложении вместо этого отправляем FCM токену жильца
  sendNotif(title, body, tag);

  // ── Live: отправка через FCM Cloud Function ──────────────────────────────────
  // При наличии сервера — раскомментировать и реализовать:
  //
  // // getFcmToken — placeholder for live FCM implementation
  // import { isLiveMode } from '../config/runtimeMode.js';
  // if (isLiveMode()) {
  //   getFcmToken(req.createdByUid).then(token => {
  //     if (!token) return;
  //     // Вызываем Cloud Function которая отправит FCM сообщение
  //     fetch('/api/notify', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ token, title, body, tag }),
  //     }).catch(e => console.warn('[push] notify failed', e));
  //   });
  // }
}

/**
 * Подписывает текущего пользователя на push-уведомления.
 * Вызывается при входе жильца в приложение.
 * Сохраняет FCM-токен в backend для дальнейшей отправки.
 *
 * @param {string} uid — uid текущего пользователя
 */
export async function subscribePush(uid) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;

  try {
    // Запрашиваем разрешение
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Регистрируем SW если нужно
    const reg = await navigator.serviceWorker.ready;

    // ── Demo: разрешение получено — показываем приветственное уведомление ─────
    reg.showNotification('Уведомления включены', {
      body: 'Вы будете получать уведомления о входе ваших гостей',
      icon: '/logo192.png',
      tag: 'push-subscribed',
      vibrate: [100],
    });

    // ── Live: получаем push-токен и сохраняем в backend ──────────────────────
    // Пример для интеграции push-SDK (при необходимости):
    //
    // import { getMessaging, getToken } from 'some-push-sdk';
    // const messaging = getMessaging();
    // const token = await getToken(messaging, { vapidKey: process.env.REACT_APP_VAPID_KEY });
    // if (token && uid) {
    //   await saveFcmToken(uid, token); // backend API endpoint
    // }

  } catch (e) {
    console.warn('[push] subscribe failed:', e);
  }
}
