import { sendNotif } from '../utils';
import { CAT_LABEL } from '../constants/index';
import type { AppRequest } from '../store/slices/requestsSlice';
import { apiClient } from './http/apiClient';

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

// ─── Web Push (VAPID) subscription ───────────────────────────────────────────
// Pure VAPID / RFC 8291. No Firebase, no Google Cloud Messaging project.
// The browser push service endpoint is treated as transport only.
// Backend signs payloads with VAPID private key; keys are generated per-deployment.

const SUBSCRIPTION_ID_KEY = 'push.subscriptionId';

/**
 * Convert a base64url-encoded VAPID public key to the Uint8Array form
 * required by PushManager.subscribe({ applicationServerKey }).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Extract a raw key from PushSubscription as base64url string.
 * The browser returns ArrayBuffers; the backend stores base64url strings.
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Неизвестное устройство';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Web';
}

/**
 * subscribePush — register the browser's push subscription with our backend.
 *
 * Flow:
 *   1. Feature-check (Notification, serviceWorker, PushManager, not denied).
 *   2. Request permission if needed.
 *   3. Fetch VAPID public key from backend.
 *   4. Ask PushManager to subscribe (reuses existing subscription if any).
 *   5. POST endpoint + p256dh/auth keys to backend; persist returned id locally.
 *
 * Failures are swallowed — a failed push setup must never break the app.
 */
export async function subscribePush(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (!('serviceWorker' in navigator)) return;
    if (Notification.permission === 'denied') return;

    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return;

    // Fetch VAPID public key (public endpoint, no auth required)
    const vapidResponse = await apiClient.get('/api/v1/push-subscriptions/vapid-public-key');
    const vapidKey: string | null = vapidResponse?.key ?? null;
    if (!vapidKey) {
      console.warn('[push] backend has no VAPID key configured — web push disabled');
      return;
    }

    // Reuse existing subscription if browser already has one for this server key,
    // otherwise create a new one.
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      // Cast: TS lib.dom types `applicationServerKey` as `BufferSource` (ArrayBuffer-backed),
      // but Uint8Array<ArrayBufferLike> from urlBase64ToUint8Array is the correct runtime value.
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      });
    }

    const p256dh = arrayBufferToBase64Url(subscription.getKey('p256dh'));
    const auth = arrayBufferToBase64Url(subscription.getKey('auth'));
    if (!p256dh || !auth) {
      console.warn('[push] missing p256dh/auth keys on subscription');
      return;
    }

    // Register with backend (idempotent upsert on user_id + endpoint)
    const result = await apiClient.post('/api/v1/push-subscriptions', {
      endpoint: subscription.endpoint,
      keys: { p256dh, auth },
      deviceName: buildDeviceName(),
    });

    const subscriptionId = result?.subscription?.id;
    if (subscriptionId && typeof localStorage !== 'undefined') {
      localStorage.setItem(SUBSCRIPTION_ID_KEY, subscriptionId);
    }
  } catch (error) {
    console.warn('[push] subscribe failed:', error);
  }
}

/**
 * unsubscribePush — user opt-out. Tears down both browser subscription
 * and backend registration. Safe to call when not subscribed.
 */
export async function unsubscribePush(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();

    // Tear down backend record if we know its id
    const subscriptionId = typeof localStorage !== 'undefined'
      ? localStorage.getItem(SUBSCRIPTION_ID_KEY)
      : null;
    if (subscriptionId) {
      try {
        await apiClient.delete(`/api/v1/push-subscriptions/${subscriptionId}`);
      } catch (err) {
        console.warn('[push] backend unsubscribe failed (continuing):', err);
      }
      localStorage.removeItem(SUBSCRIPTION_ID_KEY);
    }

    // Tear down browser subscription last so localStorage is cleaned even if this throws
    if (subscription) {
      try {
        await subscription.unsubscribe();
      } catch (err) {
        console.warn('[push] browser unsubscribe failed:', err);
      }
    }
  } catch (error) {
    console.warn('[push] unsubscribe failed:', error);
  }
}
