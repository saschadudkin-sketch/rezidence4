import type { RequestType } from '../store/slices/requestsSlice';
import type { UserRole } from '../store/slices/usersSlice';

export type CreateDraft = {
  cat: string;
  vName: string;
  vNames: string[];
  vPhone: string;
  carPlate: string;
  apartment: string;
  comment: string;
  validUntil: string;
  showSchedule: boolean;
  scheduledFor: string;
  residentStep?: number;
  showAdvanced?: boolean;
  updatedAt: number;
};

const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'rezidence4:create-draft';

function getDraftStorage() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function getLegacyDraftStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getCreateDraftKey(userUid: string, userRole: UserRole | string, type: RequestType): string {
  return `${STORAGE_PREFIX}:${userUid}:${userRole}:${type}`;
}

function isCreateDraft(value: unknown): value is CreateDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<CreateDraft>;
  return typeof draft.cat === 'string'
    && typeof draft.vName === 'string'
    && Array.isArray(draft.vNames)
    && typeof draft.vPhone === 'string'
    && typeof draft.carPlate === 'string'
    && typeof draft.apartment === 'string'
    && typeof draft.comment === 'string'
    && typeof draft.validUntil === 'string'
    && typeof draft.showSchedule === 'boolean'
    && typeof draft.scheduledFor === 'string'
    && typeof draft.updatedAt === 'number';
}

export function loadCreateDraft(key: string): CreateDraft | null {
  const storage = getDraftStorage();
  const legacyStorage = getLegacyDraftStorage();
  if (!storage || !legacyStorage) return null;
  try {
    const raw = storage.getItem(key) ?? legacyStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isCreateDraft(parsed)) {
      storage.removeItem(key);
      legacyStorage.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.updatedAt > DRAFT_TTL_MS) {
      storage.removeItem(key);
      legacyStorage.removeItem(key);
      return null;
    }
    if (!storage.getItem(key) && legacyStorage.getItem(key)) {
      storage.setItem(key, JSON.stringify(parsed));
      legacyStorage.removeItem(key);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCreateDraft(key: string, draft: Omit<CreateDraft, 'updatedAt'>): void {
  const storage = getDraftStorage();
  const legacyStorage = getLegacyDraftStorage();
  if (!storage || !legacyStorage) return;
  try {
    storage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() } satisfies CreateDraft));
    legacyStorage.removeItem(key);
  } catch {
    // Autosave is best-effort only.
  }
}

export function clearCreateDraft(key: string): void {
  const storage = getDraftStorage();
  const legacyStorage = getLegacyDraftStorage();
  if (!storage || !legacyStorage) return;
  try {
    storage.removeItem(key);
    legacyStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
