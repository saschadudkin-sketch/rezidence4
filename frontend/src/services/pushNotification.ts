import { sendNotif } from '../utils';
import { CAT_LABEL } from '../constants/index';
import type { AppRequest } from '../store/slices/requestsSlice';

function getGuestLabel(req: AppRequest): string {
  if (req.visitorName) return req.visitorName;
  return req.category && req.category in CAT_LABEL
    ? CAT_LABEL[req.category as keyof typeof CAT_LABEL]
    : 'Гость';
}

export function pushNotifyResident(req: AppRequest): void {
  const guestLabel = getGuestLabel(req);
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const aptStr = req.createdByApt && req.createdByApt !== '—' ? `, апарт. ${req.createdByApt}` : '';

  const title = '🚪 Ваш гость вошёл';
  const body = `${guestLabel}${aptStr} — вход в ${time}`;
  const tag = `guest-arrived-${req.id}`;
  const url = `/?reqId=${req.id}`;

  sendNotif(title, body, tag, { url });
}

export async function subscribePush(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('Уведомления включены', {
      body: 'Вы будете получать уведомления о входе ваших гостей',
      icon: '/logo192.png',
      tag: 'push-subscribed',
    } as NotificationOptions);
  } catch (error) {
    console.warn('[push] subscribe failed:', error);
  }
}
