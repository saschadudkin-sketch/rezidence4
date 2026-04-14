import { getSwReg } from './swUtils';

type NotificationExtra = { url?: string };
type AlertType = 'pass' | 'tech';
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Р—Р°РїСЂР°С€РёРІР°РµС‚ СЂР°Р·СЂРµС€РµРЅРёРµ РЅР° push-СѓРІРµРґРѕРјР»РµРЅРёСЏ */
export function requestNotifPerm(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/**
 * РџРѕРєР°Р·С‹РІР°РµС‚ СЃРёСЃС‚РµРјРЅРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ (С‡РµСЂРµР· SW РёР»Рё РЅР°РїСЂСЏРјСѓСЋ).
 */
export function sendNotif(title: string, body: string, tag = 'default', extra: NotificationExtra = {}): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const swReg = getSwReg();
    if (swReg) {
      void swReg.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: '/logo192.png',
        badge: '/logo192.png',
        data: { url: extra.url || '/' },
      } as NotificationOptions);
      return;
    }

    void new Notification(title, { body, icon: '/logo192.png' });
  } catch {
    // Notification failures should never break user flows.
  }
}

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

/** Р’РѕСЃРїСЂРѕРёР·РІРѕРґРёС‚ Р·РІСѓРєРѕРІРѕР№ СЃРёРіРЅР°Р» С‚РёРїР° В«passВ» РёР»Рё В«techВ» */
export function playAlert(type: AlertType): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const notes: ReadonlyArray<readonly [number, number, number]> = type === 'pass'
      ? [[880, 0, 0.12], [1046, 0.13, 0.12], [1318, 0.26, 0.18]]
      : [[660, 0, 0.1], [660, 0.12, 0.1], [880, 0.25, 0.15]];

    notes.forEach(([freq, delay, duration]) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = freq;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      oscillator.start(ctx.currentTime + delay);
      oscillator.stop(ctx.currentTime + delay + duration + 0.05);
    });
  } catch {
    // Audio failures should never break user flows.
  }
}
