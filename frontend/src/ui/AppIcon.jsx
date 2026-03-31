import React from 'react';

const PATHS = {
  ticket: 'M3 10h18v4a2 2 0 0 1 0 4v4H3v-4a2 2 0 0 1 0-4v-4zM8 10v12m8-12v12',
  tools: 'M14 4l6 6-3 3-6-6m-1 1L4 14l-1 6 6-1 6-6',
  list: 'M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01',
  file: 'M8 3h8l5 5v13H8zM16 3v6h5',
  history: 'M12 8v5l4 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4',
  chat: 'M4 5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  residents: 'M16 19v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 19v-2a4 4 0 0 0-3-3.9M14 3.2a4 4 0 0 1 0 7.6',
  ban: 'M5 5l14 14M7 12a5 5 0 0 1 5-5m7 5a5 5 0 0 1-5 5',
  shield: 'M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z',
  chart: 'M5 20V10M12 20V5M19 20v-8',
  users: 'M7 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 20v-1a3 3 0 0 1 3-3m10-10a3 3 0 1 1-1 5.8',
  car: 'M4 14l2-6h12l2 6M5 14h14v4H5zM7 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2M17 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  alert: 'M12 4 3 20h18L12 4zm0 5v5m0 3h.01',
  check: 'M20 7 9 18l-5-5',
  denied: 'M18 6 6 18M6 6l12 12',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  undo: 'M9 14 4 9l5-5M4 9h9a7 7 0 1 1 0 14h-1',
  phone: 'M7 4h10v16H7zM11 18h2',
  info: 'M12 16v-4M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  door: 'M5 21h14M7 21V4h10v17M13 12h.01',
  search: 'm21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
  camera: 'M4 7h4l2-3h4l2 3h4v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  close: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'm9 6 6 6-6 6',
};

export const APP_ICON_NAMES = Object.freeze(Object.keys(PATHS));
const warnedUnknownIcons = new Set();
export function __resetAppIconWarningsForTests() {
  warnedUnknownIcons.clear();
}

export function AppIcon({ name, size = 16, className = '', strokeWidth = 1.9 }) {
  const path = PATHS[name] || PATHS.list;
  if (!PATHS[name] && process.env.NODE_ENV !== 'production' && !warnedUnknownIcons.has(name)) {
    warnedUnknownIcons.add(name);
    // eslint-disable-next-line no-console
    console.warn(`[AppIcon] Unknown icon name "${name}", fallback to "list".`);
  }
  return (
    <svg
      className={`app-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
