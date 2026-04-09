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
let lockedScrollY = 0;
let prevBodyPosition = '';
let prevBodyTop = '';
let prevBodyWidth = '';
let prevBodyOverflow = '';

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    prevBodyPosition = document.body.style.position;
    prevBodyTop = document.body.style.top;
    prevBodyWidth = document.body.style.width;
    prevBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.width = '100%';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = prevBodyOverflow;
    document.body.style.position = prevBodyPosition;
    document.body.style.top = prevBodyTop;
    document.body.style.width = prevBodyWidth;
    window.scrollTo(0, lockedScrollY);
  }
}
