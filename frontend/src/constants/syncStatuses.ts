export const SYNC_STATUS = {
  LOCAL: 'local',
  REMOTE: 'remote',
  LOCAL_FALLBACK: 'local_fallback',
} as const;

export type SyncStatusValue = typeof SYNC_STATUS[keyof typeof SYNC_STATUS];
