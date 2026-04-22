/**
 * Design System Tokens - TypeScript Constants
 * Export typed constants mirroring the CSS vars for use in JavaScript
 * (charts, canvas, animations, dynamic styles)
 */

export const dsTokens = {
  colors: {
    // Background
    bgBase: '#11100e',
    bgSurface: '#201d19',
    bgRaised: '#2a2621',

    // Accent
    accent: '#c9a96e',
    accentHover: '#b8935a',
    accentMuted: 'rgba(201, 169, 110, 0.12)',

    // Text
    textPrimary: '#eee7dc',
    textSecondary: '#c7bdae',
    textMuted: '#b2a593',

    // Border
    border: 'rgba(201, 169, 110, 0.12)',
    borderStrong: 'rgba(201, 169, 110, 0.25)',

    // Status
    success: '#6fa07e',
    successMuted: 'rgba(111, 160, 126, 0.15)',
    error: '#d47070',
    errorMuted: 'rgba(212, 112, 112, 0.15)',
    warning: '#c9a96e',
    warningMuted: 'rgba(201, 169, 110, 0.15)',
    info: '#60a5fa',
    infoMuted: 'rgba(96, 165, 250, 0.15)',
  },

  motion: {
    transitionFast: '120ms ease',
    transitionBase: '200ms ease',
    transitionSlow: '350ms ease',
    transitionSpring: '400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },

  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },

  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.4)',
    md: '0 4px 16px rgba(0,0,0,0.5)',
    lg: '0 8px 32px rgba(0,0,0,0.6)',
    gold: '0 0 20px rgba(201,169,110,0.2)',
  },
} as const;

export type DsTokens = typeof dsTokens;