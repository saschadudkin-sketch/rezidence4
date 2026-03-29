/**
 * ui/scrollLock.js — утилита блокировки скролла с подсчётом вложенности.
 *
 * Решает проблему: если модал A открыт, потом открывается модал B,
 * и B закрывается — скролл не должен разблокироваться, пока A открыт.
 *
 * Использование:
 *   useEffect(() => { lockScroll(); return unlockScroll; }, []);
 */

let lockCount = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = '';
  }
}
