export const BREAKPOINTS = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1536,
} as const;

export const MEDIA_QUERIES = {
  lgDown: `(max-width:${BREAKPOINTS.lg}px)`,
} as const;
