/** CQ-02: migrated from idUtils.js — generates unique IDs with optional prefix */
export const genId = (prefix = ''): string => {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return prefix + id;
};
